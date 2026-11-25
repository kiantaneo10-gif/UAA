import { auth, db } from "./firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const adminContent = document.getElementById("admin-content");
const adminMessage = document.getElementById("admin-message");
const productForm = document.getElementById("admin-product-form");
const reportForm = document.getElementById("admin-report-form");
const reportExportButton = document.getElementById("admin-export-report");
let loadedAdminId = null;
let loadedReport = null;
let loadedReportFilters = null;
let dashboardUnsubscribers = [];
let dashboardListenerVersion = 0;
let dashboardHasLoaded = false;
let dashboardData = { orders: null, products: null, users: null };

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function peso(value) {
  return "₱" + Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formattedDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-PH");
}

function setMessage(text, isError) {
  adminMessage.textContent = text || "";
  adminMessage.classList.toggle("is-error", Boolean(isError));
}

function timestampToString(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value ? String(value) : "";
}

function mapOrder(snapshot) {
  const data = snapshot.data();
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    id: snapshot.id,
    ...data,
    createdAt: timestampToString(data.createdAt),
    items: items.map((item) => `${item.name || "Item"} × ${item.quantity || 0}`).join(", "),
    orderItems: items,
  };
}

async function getOrders() {
  const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(ordersQuery);
  return snapshot.docs.map(mapOrder);
}

async function getProducts() {
  const snapshot = await getDocs(collection(db, "products"));
  return snapshot.docs
    .map((product) => ({ id: product.id, ...product.data() }))
    .sort((left, right) =>
      (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0) ||
      left.id.localeCompare(right.id)
    );
}

async function getUsers() {
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs
    .map((user) => ({ id: user.id, ...user.data(), createdAt: timestampToString(user.data().createdAt) }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function dashboardSummary(orders, products, users) {
  const paidOrders = orders.filter((order) =>
    order.paymentStatus === "paid" && order.orderStatus !== "cancelled"
  );
  const pendingOrders = orders.filter((order) =>
    order.paymentStatus === "pending" && order.orderStatus !== "cancelled"
  );
  return {
    order_count: orders.length,
    paid_order_count: paidOrders.length,
    paid_revenue: paidOrders.reduce((total, order) => total + Number(order.total || 0), 0),
    pending_total: pendingOrders.reduce((total, order) => total + Number(order.total || 0), 0),
    product_count: products.length,
    available_product_count: products.filter((product) => product.stockStatus === "in_stock").length,
    customer_count: users.filter((user) => user.role === "customer").length,
  };
}

async function adminRequest(action, data, params) {
  switch (action) {
    case "orders":
      return { orders: await getOrders() };
    case "products":
      return { products: await getProducts() };
    case "users":
      return { users: await getUsers() };
    case "reports": {
      const from = (params && params.from) || "";
      const to = (params && params.to) || "";
      if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Enter dates in YYYY-MM-DD format.");
      if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Enter dates in YYYY-MM-DD format.");
      if (from && to && from > to) throw new Error("The start date must be on or before the end date.");
      const orders = (await getOrders()).filter((order) => {
        const orderDate = order.createdAt.slice(0, 10);
        return (!from || orderDate >= from) && (!to || orderDate <= to);
      });
      const activeOrders = orders.filter((order) => order.orderStatus !== "cancelled");
      const paidOrders = activeOrders.filter((order) => order.paymentStatus === "paid");
      const pendingOrders = activeOrders.filter((order) => order.paymentStatus === "pending");
      return {
        from,
        to,
        summary: {
          order_count: orders.length,
          order_value: activeOrders.reduce((total, order) => total + Number(order.total || 0), 0),
          paid_revenue: paidOrders.reduce((total, order) => total + Number(order.total || 0), 0),
          pending_total: pendingOrders.reduce((total, order) => total + Number(order.total || 0), 0),
          cancelled_count: orders.filter((order) => order.orderStatus === "cancelled").length,
        },
        orders,
      };
    }
    case "product-create":
    case "product-update": {
      const id = String(data.id || "").trim();
      const name = String(data.name || "").trim();
      const price = Number(data.price);
      const category = String(data.category || "").trim();
      const status = String(data.status || "");
      const stockStatus = String(data.stockStatus || "");
      const image = String(data.image || "").trim();
      const description = String(data.description || "").trim();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error("Product ID must contain lowercase letters, numbers, and hyphens.");
      if (name.length < 2 || name.length > 160) throw new Error("Enter a product name between 2 and 160 characters.");
      if (!Number.isFinite(price) || price < 0 || price > 99999999.99) throw new Error("Enter a valid product price.");
      if (!/^[a-z0-9-]{1,40}$/.test(category)) throw new Error("Enter a valid product category.");
      if (!["", "new", "popular", "sale"].includes(status)) throw new Error("Choose a valid product badge.");
      if (!["in_stock", "out_of_stock"].includes(stockStatus)) throw new Error("Choose a valid stock status.");
      if (!image.startsWith("img/products/") || image.includes("..") || image.length > 255) {
        throw new Error("Product images must use a path under img/products/.");
      }
      if (description.length > 5000) throw new Error("Product description is too long.");

      const productRef = doc(db, "products", id);
      const fields = { name, price: Math.round(price * 100) / 100, category, status, stockStatus, image, description };
      if (action === "product-create") {
        const products = await getProducts();
        const sortOrder = products.reduce((maximum, product) =>
          Math.max(maximum, Number(product.sortOrder) || 0), 0) + 1;
        await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(productRef);
          if (existing.exists()) throw new Error("A product with that ID already exists.");
          transaction.set(productRef, { ...fields, sortOrder });
        });
      } else {
        const existing = await getDoc(productRef);
        if (!existing.exists()) throw new Error("Product not found.");
        await updateDoc(productRef, fields);
      }
      return { ok: true };
    }
    case "product-stock": {
      const id = String(data.id || "");
      const stockStatus = String(data.stockStatus || "");
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !["in_stock", "out_of_stock"].includes(stockStatus)) {
        throw new Error("Invalid product stock update.");
      }
      const productRef = doc(db, "products", id);
      if (!(await getDoc(productRef)).exists()) throw new Error("Product not found.");
      await updateDoc(productRef, { stockStatus });
      return { ok: true };
    }
    case "product-delete": {
      const id = String(data.id || "");
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error("Invalid product ID.");
      const productRef = doc(db, "products", id);
      if (!(await getDoc(productRef)).exists()) throw new Error("Product not found.");
      await deleteDoc(productRef);
      return { ok: true };
    }
    case "user-status": {
      const userId = String(data.userId || "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId) || typeof data.isActive !== "boolean") {
        throw new Error("Invalid account status update.");
      }
      if (!auth.currentUser || userId === auth.currentUser.uid) {
        throw new Error("You cannot suspend your own administrator account.");
      }
      const userRef = doc(db, "users", userId);
      const userSnapshot = await getDoc(userRef);
      if (!userSnapshot.exists() || userSnapshot.data().role !== "customer") throw new Error("Customer account not found.");
      await updateDoc(userRef, { isActive: data.isActive });
      return { ok: true };
    }
    case "order-update": {
      const orderId = String(data.orderId || "");
      const paymentStatus = String(data.paymentStatus || "");
      const orderStatus = String(data.orderStatus || "");
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(orderId) ||
        !["pending", "paid", "failed"].includes(paymentStatus) ||
        !["pending", "processing", "shipped", "completed", "cancelled"].includes(orderStatus)
      ) {
        throw new Error("Invalid order update.");
      }
      const orderRef = doc(db, "orders", orderId);
      if (!(await getDoc(orderRef)).exists()) throw new Error("Order not found.");
      await updateDoc(orderRef, { paymentStatus, orderStatus, updatedAt: serverTimestamp() });
      return { ok: true };
    }
    default:
      throw new Error("Unknown admin action.");
  }
}

function statusOptions(options, selected) {
  return options.map(([value, label]) => (
    `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
  )).join("");
}

function renderOrderItems(order) {
  const items = Array.isArray(order.orderItems) ? order.orderItems : [];
  if (!items.length) return escapeHtml(order.items || "—");

  return `
    <div class="admin-order-items">
      ${items.map((item) => `
        <div class="admin-order-item">
          ${item.image
            ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
            : '<span class="admin-order-image-placeholder" aria-label="Image unavailable">—</span>'}
          <span class="admin-order-item-name">
            ${escapeHtml(item.name)}
            <small>Qty: ${escapeHtml(item.quantity)}</small>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderOrders(orders) {
  const body = document.getElementById("admin-orders-body");
  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="8">No orders yet.</td></tr>';
    return;
  }

  body.innerHTML = orders.map((order) => `
    <tr>
      <td><strong class="admin-order-number">${escapeHtml(order.orderNumber)}</strong></td>
      <td>${escapeHtml(order.customerName)}<small>${escapeHtml(order.customerEmail)}</small></td>
      <td>${renderOrderItems(order)}</td>
      <td>${peso(order.total)}</td>
      <td>${escapeHtml(String(order.paymentMethod || "COD").toUpperCase())}<small>${escapeHtml(order.paymentStatus)}</small></td>
      <td>${escapeHtml(order.orderStatus)}</td>
      <td>${escapeHtml(formattedDate(order.createdAt))}</td>
      <td>
        <form class="admin-order-form" data-order-id="${escapeHtml(order.id)}">
          <label class="sr-only">Payment status</label>
          <select name="paymentStatus" aria-label="Payment status">
            ${statusOptions([["pending", "Pending payment"], ["paid", "Paid"], ["failed", "Failed"]], order.paymentStatus)}
          </select>
          <label class="sr-only">Order status</label>
          <select name="orderStatus" aria-label="Fulfillment status">
            ${statusOptions([["pending", "Pending"], ["processing", "Processing"], ["shipped", "Shipped"], ["completed", "Completed"], ["cancelled", "Cancelled"]], order.orderStatus)}
          </select>
          <button type="submit" class="admin-button admin-button-small">Save</button>
        </form>
      </td>
    </tr>
  `).join("");
}

function renderReports(report) {
  const summary = report.summary;
  document.getElementById("admin-report-order-count").textContent = summary.order_count;
  document.getElementById("admin-report-order-value").textContent = peso(summary.order_value);
  document.getElementById("admin-report-paid-revenue").textContent = peso(summary.paid_revenue);
  document.getElementById("admin-report-pending-total").textContent = peso(summary.pending_total);
  document.getElementById("admin-report-cancelled-count").textContent =
    `Cancelled orders: ${summary.cancelled_count}`;

  const body = document.getElementById("admin-reports-body");
  if (!report.orders.length) {
    body.innerHTML = '<tr><td colspan="9">No orders match this date range.</td></tr>';
    return;
  }

  body.innerHTML = report.orders.map((order) => `
    <tr>
      <td><strong class="admin-order-number">${escapeHtml(order.orderNumber)}</strong></td>
      <td>${escapeHtml(formattedDate(order.createdAt))}</td>
      <td>${escapeHtml(order.customerName)}<small>${escapeHtml(order.customerEmail)}</small></td>
      <td>${renderOrderItems(order)}</td>
      <td>${peso(order.subtotal)}</td>
      <td>${peso(order.discount)}</td>
      <td>${peso(order.total)}</td>
      <td>${escapeHtml(String(order.paymentMethod || "COD").toUpperCase())}<small>${escapeHtml(order.paymentStatus)}</small></td>
      <td>${escapeHtml(order.orderStatus)}</td>
    </tr>
  `).join("");
}

async function refreshReports() {
  const from = reportForm.elements.namedItem("from").value;
  const to = reportForm.elements.namedItem("to").value;
  reportExportButton.disabled = true;
  if (from && to && from > to) {
    loadedReport = null;
    loadedReportFilters = null;
    setMessage("The start date must be on or before the end date.", true);
    return;
  }
  setMessage("Loading report…", false);

  try {
    const report = await adminRequest("reports", null, { from, to });
    renderReports(report);
    loadedReport = report;
    loadedReportFilters = { from, to };
    reportExportButton.disabled = false;
    setMessage("Report is up to date.", false);
  } catch (error) {
    loadedReport = null;
    loadedReportFilters = null;
    setMessage(error.message || "Could not load the report.", true);
  }
}

function csvField(value) {
  let text = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportReport() {
  if (!loadedReport || !loadedReportFilters) return;

  const headings = [
    "Order ID",
    "Date",
    "Customer",
    "Email",
    "Items",
    "Subtotal",
    "Discount",
    "Total",
    "Payment method",
    "Payment status",
    "Fulfillment status",
  ];
  const rows = loadedReport.orders.map((order) => [
    order.orderNumber,
    order.createdAt,
    order.customerName,
    order.customerEmail,
    order.items || "",
    order.subtotal,
    order.discount,
    order.total,
    order.paymentMethod,
    order.paymentStatus,
    order.orderStatus,
  ]);
  const csv = [headings, ...rows]
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `uaa-orders-${loadedReportFilters.from || "all"}-to-${loadedReportFilters.to || "all"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderProducts(products) {
  const body = document.getElementById("admin-products-body");
  if (!products.length) {
    body.innerHTML = '<tr><td colspan="5">No products found.</td></tr>';
    return;
  }

  body.innerHTML = products.map((product) => {
    const stockStatus = product.stockStatus === "out_of_stock" ? "out_of_stock" : "in_stock";
    const nextStockStatus = stockStatus === "in_stock" ? "out_of_stock" : "in_stock";
    const stockLabel = stockStatus === "in_stock" ? "In stock" : "Out of stock";
    return `
      <tr>
        <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.id)}</small></td>
        <td>${peso(product.price)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${stockLabel}</td>
        <td class="admin-actions">
          <button type="button" class="admin-button admin-button-small" data-edit-product="${escapeHtml(product.id)}">Edit</button>
          <button type="button" class="admin-button admin-button-small admin-button-secondary" data-stock-id="${escapeHtml(product.id)}" data-stock-status="${nextStockStatus}">
            ${stockStatus === "in_stock" ? "Mark out of stock" : "Restock"}
          </button>
          <button type="button" class="admin-button admin-button-small admin-button-danger" data-delete-product="${escapeHtml(product.id)}">Delete</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderUsers(users) {
  const body = document.getElementById("admin-users-body");
  if (!users.length) {
    body.innerHTML = '<tr><td colspan="6">No customer accounts yet.</td></tr>';
    return;
  }

  body.innerHTML = users.map((user) => {
    const active = Boolean(user.isActive);
    const isCustomer = user.role === "customer";
    return `
      <tr>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(user.role)}</td>
        <td>${active ? "Active" : "Suspended"}</td>
        <td>${formattedDate(user.createdAt)}</td>
        <td>
          ${isCustomer
            ? `<button type="button" class="admin-button admin-button-small ${active ? "admin-button-danger" : "admin-button-secondary"}" data-user-id="${escapeHtml(user.id)}" data-user-active="${active ? "false" : "true"}">${active ? "Suspend" : "Reactivate"}</button>`
            : "Managed by CLI"}
        </td>
      </tr>
    `;
  }).join("");
}

function stopDashboardListeners() {
  dashboardListenerVersion += 1;
  dashboardUnsubscribers.forEach((unsubscribe) => unsubscribe());
  dashboardUnsubscribers = [];
  dashboardHasLoaded = false;
  dashboardData = { orders: null, products: null, users: null };
}

function renderDashboardData() {
  const { orders, products, users } = dashboardData;
  if (!orders || !products || !users) return;

  const summary = dashboardSummary(orders, products, users);
  document.getElementById("admin-paid-revenue").textContent = peso(summary.paid_revenue);
  document.getElementById("admin-pending-total").textContent = peso(summary.pending_total);
  document.getElementById("admin-paid-orders").textContent = summary.paid_order_count;
  document.getElementById("admin-order-count").textContent = summary.order_count;
  document.getElementById("admin-customer-count").textContent = summary.customer_count;
  document.getElementById("admin-product-count").textContent = summary.product_count;
  document.getElementById("admin-available-product-count").textContent = summary.available_product_count;
  renderOrders(orders);
  renderProducts(products);
  renderUsers(users);

  if (!dashboardHasLoaded) {
    dashboardHasLoaded = true;
    setMessage("Dashboard connected to Firebase. Live updates are active.", false);
  }
}

function startDashboardListeners() {
  stopDashboardListeners();
  const listenerVersion = dashboardListenerVersion;
  setMessage("Connecting dashboard to Firebase…", false);

  const handleError = (error) => {
    if (listenerVersion !== dashboardListenerVersion) return;
    console.error("Admin dashboard could not read live Firestore data:", error);
    stopDashboardListeners();
    loadedAdminId = null;
    setMessage(error.message || "Could not connect the admin dashboard to Firestore.", true);
  };

  const handleSnapshot = (key, snapshot, mapDocument) => {
    if (listenerVersion !== dashboardListenerVersion) return;
    dashboardData[key] = snapshot.docs.map(mapDocument);
    renderDashboardData();
  };

  try {
    dashboardUnsubscribers.push(onSnapshot(
      query(collection(db, "orders"), orderBy("createdAt", "desc")),
      (snapshot) => handleSnapshot("orders", snapshot, mapOrder),
      handleError
    ));
    dashboardUnsubscribers.push(onSnapshot(
      collection(db, "products"),
      (snapshot) => {
        if (listenerVersion !== dashboardListenerVersion) return;
        dashboardData.products = snapshot.docs
          .map((product) => ({ id: product.id, ...product.data() }))
          .sort((left, right) =>
            (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0) ||
            left.id.localeCompare(right.id)
          );
        renderDashboardData();
      },
      handleError
    ));
    dashboardUnsubscribers.push(onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        if (listenerVersion !== dashboardListenerVersion) return;
        dashboardData.users = snapshot.docs
          .map((user) => ({
            id: user.id,
            ...user.data(),
            createdAt: timestampToString(user.data().createdAt),
          }))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        renderDashboardData();
      },
      handleError
    ));
  } catch (error) {
    handleError(error);
  }
}

function resetProductForm() {
  productForm.reset();
  productForm.hidden = true;
  productForm.dataset.editing = "false";
  document.getElementById("admin-product-id").readOnly = false;
  document.getElementById("admin-product-form-title").textContent = "Add product";
}

function editProduct(product) {
  productForm.hidden = false;
  productForm.dataset.editing = "true";
  productForm.elements.namedItem("id").value = product.id;
  productForm.elements.namedItem("id").readOnly = true;
  productForm.elements.namedItem("name").value = product.name;
  productForm.elements.namedItem("price").value = product.price;
  productForm.elements.namedItem("category").value = product.category;
  productForm.elements.namedItem("status").value = product.status || "";
  productForm.elements.namedItem("stockStatus").value = product.stockStatus;
  productForm.elements.namedItem("image").value = product.image;
  productForm.elements.namedItem("description").value = product.description;
  document.getElementById("admin-product-form-title").textContent = "Edit product";
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function initializeAdmin(user) {
  if (!user || user.role !== "admin") {
    stopDashboardListeners();
    loadedAdminId = null;
    adminContent.hidden = true;
    setMessage(user
      ? "Administrator access is required. This account does not have the admin role."
      : "Sign in with an administrator account to open this dashboard.", true);
    return;
  }

  adminContent.hidden = false;
  if (loadedAdminId === user.id) return;
  loadedAdminId = user.id;
  startDashboardListeners();
}

document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-admin-tab]").forEach((item) => {
      item.classList.toggle("is-active", item === tab);
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.adminPanel !== tab.dataset.adminTab;
    });
    if (tab.dataset.adminTab === "reports") refreshReports();
  });
});

reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  refreshReports();
});

reportForm.addEventListener("input", () => {
  reportExportButton.disabled = true;
});

reportExportButton.addEventListener("click", exportReport);

document.getElementById("admin-add-product").addEventListener("click", () => {
  resetProductForm();
  productForm.hidden = false;
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("admin-cancel-product").addEventListener("click", resetProductForm);

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const editing = productForm.dataset.editing === "true";
  const payload = Object.fromEntries(new FormData(productForm).entries());
  const submit = productForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await adminRequest(editing ? "product-update" : "product-create", payload);
    setMessage(editing ? "Product updated." : "Product added.", false);
    resetProductForm();
  } catch (error) {
    setMessage(error.message || "Could not save product.", true);
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".admin-order-form");
  if (!form) return;
  event.preventDefault();
  const values = new FormData(form);
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await adminRequest("order-update", {
      orderId: form.dataset.orderId,
      paymentStatus: values.get("paymentStatus"),
      orderStatus: values.get("orderStatus"),
    });
    setMessage("Order updated.", false);
  } catch (error) {
    setMessage(error.message || "Could not update order.", true);
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    editButton.disabled = true;
    try {
      const products = await adminRequest("products");
      const product = products.products.find((item) => item.id === editButton.dataset.editProduct);
      if (product) editProduct(product);
      else setMessage("Product not found. Refresh the dashboard and try again.", true);
    } catch (error) {
      setMessage(error.message || "Could not load product details.", true);
    } finally {
      editButton.disabled = false;
    }
    return;
  }

  const stockButton = event.target.closest("[data-stock-id]");
  if (stockButton) {
    stockButton.disabled = true;
    try {
      await adminRequest("product-stock", {
        id: stockButton.dataset.stockId,
        stockStatus: stockButton.dataset.stockStatus,
      });
      setMessage("Product stock updated.", false);
    } catch (error) {
      setMessage(error.message || "Could not update stock status.", true);
      stockButton.disabled = false;
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-product]");
  if (deleteButton) {
    if (!window.confirm("Delete this product? Past order records will be retained.")) return;
    deleteButton.disabled = true;
    try {
      await adminRequest("product-delete", { id: deleteButton.dataset.deleteProduct });
      setMessage("Product deleted.", false);
    } catch (error) {
      setMessage(error.message || "Could not delete product.", true);
      deleteButton.disabled = false;
    }
    return;
  }

  const userButton = event.target.closest("[data-user-id]");
  if (userButton) {
    const isActive = userButton.dataset.userActive === "true";
    if (!isActive && !window.confirm("Suspend this customer account? Their order history will be kept.")) return;
    userButton.disabled = true;
    try {
      await adminRequest("user-status", {
        userId: userButton.dataset.userId,
        isActive,
      });
      setMessage(isActive ? "Customer account reactivated." : "Customer account suspended.", false);
    } catch (error) {
      setMessage(error.message || "Could not update customer account.", true);
      userButton.disabled = false;
    }
  }
});

window.addEventListener("auth:changed", (event) => {
  initializeAdmin(event.detail.user);
});

if (window.authReady) {
  window.authReady.then(() => initializeAdmin(window.currentUser));
} else {
  setMessage("The account service did not initialize.", true);
}
