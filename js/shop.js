/**
 * Unique Arts Apparel – products, cart + checkout
 * Products and orders use Firebase; cart data stays in localStorage.
 */
import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

(function () {
  "use strict";

  const CART_KEY = "uaa_cart";
  const COUPON_KEY = "uaa_coupon";
  const MAX_PRODUCT_QUANTITY = 20;
  const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

  let PRODUCTS = [];
  window.SHOP_PRODUCTS = PRODUCTS;

  /* ---------- helpers ---------- */
  function normalizeCartItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const hasPrice = typeof item.price === "number" ||
      (typeof item.price === "string" && item.price.trim() !== "");
    const hasQuantity = typeof item.qty === "number" ||
      (typeof item.qty === "string" && item.qty.trim() !== "");
    const price = Number(item.price);
    const qty = Number(item.qty);
    if (
      !PRODUCT_ID_PATTERN.test(id) ||
      !name ||
      name.length > 160 ||
      !hasPrice ||
      !Number.isFinite(price) ||
      price < 0 ||
      !hasQuantity ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_PRODUCT_QUANTITY ||
      (item.stockStatus != null && !["in_stock", "out_of_stock"].includes(item.stockStatus)) ||
      (item.image != null && typeof item.image !== "string") ||
      (typeof item.image === "string" && item.image.length > 255)
    ) {
      return null;
    }

    return {
      id,
      name,
      price,
      image: typeof item.image === "string" ? item.image : "",
      stockStatus: item.stockStatus === "out_of_stock" ? "out_of_stock" : "in_stock",
      qty,
    };
  }

  function getCart() {
    let stored;
    try {
      stored = localStorage.getItem(CART_KEY);
    } catch (error) {
      console.error("Could not read the saved cart:", error);
      showToast("Could not access your saved cart. Check your browser storage settings.");
      return [];
    }
    if (!stored) return [];

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch (error) {
      console.error("Saved cart data is invalid:", error);
      try {
        localStorage.removeItem(CART_KEY);
        showToast("Your saved cart was invalid and has been cleared.");
      } catch (storageError) {
        console.error("Could not clear invalid cart data:", storageError);
        showToast("Your saved cart is invalid and could not be cleared. Check browser storage settings.");
      }
      return [];
    }
    if (!Array.isArray(parsed)) {
      console.error("Saved cart data is not a list.");
      try {
        localStorage.removeItem(CART_KEY);
        showToast("Your saved cart was invalid and has been cleared.");
      } catch (error) {
        console.error("Could not clear invalid cart data:", error);
        showToast("Your saved cart is invalid and could not be cleared. Check browser storage settings.");
      }
      return [];
    }

    const quantities = new Map();
    const cart = [];
    parsed.forEach((value) => {
      const item = normalizeCartItem(value);
      if (!item) return;
      const total = (quantities.get(item.id) || 0) + item.qty;
      if (total > MAX_PRODUCT_QUANTITY) return;
      quantities.set(item.id, total);
      cart.push(item);
    });
    if (cart.length !== parsed.length) {
      console.error("Invalid items were found in the saved cart.");
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        showToast("Invalid items were removed from your saved cart.");
      } catch (error) {
        console.error("Could not repair the saved cart:", error);
        showToast("Invalid cart items could not be saved. Check browser storage settings.");
      }
    }
    return cart;
  }

  function saveCart(cart) {
    const normalized = Array.isArray(cart) ? cart.map(normalizeCartItem) : [];
    if (!Array.isArray(cart) || normalized.some((item) => item === null)) {
      console.error("Refusing to save invalid cart data.");
      showToast("Could not save your cart because an item is invalid.");
      return false;
    }
    const quantities = new Map();
    for (const item of normalized) {
      const total = (quantities.get(item.id) || 0) + item.qty;
      if (total > MAX_PRODUCT_QUANTITY) {
        showToast(`You can add up to ${MAX_PRODUCT_QUANTITY} of each product per order.`);
        return false;
      }
      quantities.set(item.id, total);
    }
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.error("Could not save the cart:", error);
      showToast("Could not save your cart. Check your browser storage settings.");
      return false;
    }
    updateCartCount();
    return true;
  }

  function clearCart() {
    try {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(COUPON_KEY);
    } catch (error) {
      console.error("Could not clear the cart:", error);
      showToast("Could not clear your cart. Check your browser storage settings.");
      return false;
    }
    updateCartCount();
    return true;
  }

  function formatPeso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function cartSubtotal(cart) {
    return cart.reduce((s, i) => s + i.price * i.qty, 0);
  }

  function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll(".cart-count").forEach((el) => {
      el.textContent = count;
    });
  }

  function showToast(msg) {
    let t = document.querySelector(".shop-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "shop-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("is-visible");
    setTimeout(() => t.classList.remove("is-visible"), 2500);
  }

  function isValidEmail(email) {
    return typeof email === "string" &&
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function clearFieldErrors(form) {
    form.querySelectorAll(".field-error").forEach((error) => error.remove());
    form.querySelectorAll(".is-invalid").forEach((input) => input.classList.remove("is-invalid"));
  }

  function showFieldError(input, message) {
    if (!input) return;
    input.classList.add("is-invalid");
    const error = document.createElement("span");
    error.className = "field-error";
    error.setAttribute("role", "alert");
    error.textContent = message;
    input.insertAdjacentElement("afterend", error);
  }

  function clearInputError(input) {
    if (!input) return;
    input.classList.remove("is-invalid");
    const error = input.nextElementSibling;
    if (error && error.classList.contains("field-error")) error.remove();
  }

  function setCheckoutError(message) {
    const error = document.getElementById("checkout-error");
    if (!error) return;
    error.textContent = message || "";
    error.hidden = !message;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showCatalogError() {
    const message = "Could not load products from Firebase. Check the Firebase project setup.";
    ["shop-product-list", "product-list", "related-product-list"].forEach((id) => {
      const list = document.getElementById(id);
      if (list) list.innerHTML = `<div class="col-12"><p class="empty-cart">${message}</p></div>`;
    });
    const detail = document.querySelector("#product-detail-page .product-content");
    if (detail) detail.innerHTML = `<p class="empty-cart">${message}</p>`;
  }

  async function loadProducts() {
    try {
      const snapshot = await getDocs(collection(db, "products"));
      PRODUCTS = snapshot.docs
        .map((product) => ({ id: product.id, ...product.data() }))
        .sort((left, right) =>
          (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0) ||
          left.id.localeCompare(right.id)
        );
      window.SHOP_PRODUCTS = PRODUCTS;
      renderShopPage();
      renderHomeProducts();
      renderProductDetail();
      renderRelatedProducts();
    } catch (error) {
      console.error("Product catalog failed to load:", error);
      showCatalogError();
    }
  }

  /* ---------- cart page ---------- */
  function renderCartPage() {
    const body = document.getElementById("cart-table-body");
    if (!body) return;

    const cart = getCart();
    if (!cart.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty-cart">Your cart is empty. <a href="categories.html">Shop now</a></td></tr>`;
      setTotals(0, 0, 0);
      return;
    }

    body.innerHTML = cart
      .map(
        (item, idx) => `
      <tr data-idx="${idx}">
        <td class="product-col">
          <img src="${escapeHtml(item.image || "img/products/product-1.jpg")}" alt="">
          <div class="p-title">
            <h5>${escapeHtml(item.name)}</h5>
          </div>
        </td>
        <td>${formatPeso(item.price)}</td>
        <td class="quan">
          <input type="number" min="1" max="20" step="1" required value="${item.qty}" class="cart-qty" data-idx="${idx}">
        </td>
        <td>${formatPeso(item.price * item.qty)}</td>
        <td><a href="#" class="remove-item" data-idx="${idx}">×</a></td>
      </tr>`
      )
      .join("");

    const sub = cartSubtotal(cart);
    const discount = getDiscount(sub);
    setTotals(sub, 0, discount);

    body.querySelectorAll(".cart-qty").forEach((inp) => {
      inp.addEventListener("change", () => {
        const cart = getCart();
        const i = +inp.dataset.idx;
        if (!cart[i]) {
          renderCartPage();
          return;
        }
        const quantity = Number(inp.value);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PRODUCT_QUANTITY) {
          inp.value = String(cart[i].qty);
          showToast(`Quantity must be a whole number from 1 to ${MAX_PRODUCT_QUANTITY}.`);
          return;
        }
        cart[i].qty = quantity;
        if (!saveCart(cart)) return;
        renderCartPage();
      });
    });

    body.querySelectorAll(".remove-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cart = getCart();
        cart.splice(+btn.dataset.idx, 1);
        if (!saveCart(cart)) return;
        renderCartPage();
        showToast("Item removed");
      });
    });
  }

  function getDiscount(sub) {
    const code = getCouponCode();
    if (code === "UAA20") return Math.round(sub * 0.2 * 100) / 100;
    return 0;
  }

  function getCouponCode() {
    try {
      const code = (localStorage.getItem(COUPON_KEY) || "").toUpperCase();
      if (!code || code === "UAA20") return code;
      console.error("An invalid saved coupon code was found.");
      localStorage.removeItem(COUPON_KEY);
      showToast("An invalid saved coupon was removed.");
      return "";
    } catch (error) {
      console.error("Could not read the saved coupon:", error);
      showToast("Could not access your saved coupon.");
      return "";
    }
  }

  function setTotals(sub, ship, disc) {
    const total = Math.max(0, sub + ship - disc);
    const el = (id, v) => {
      const n = document.getElementById(id);
      if (n) n.textContent = formatPeso(v);
    };
    el("cart-subtotal", sub);
    el("cart-shipping", ship);
    el("cart-discount", disc);
    el("cart-total", total);
  }

  /* ---------- checkout summary ---------- */
  function renderCheckoutSummary() {
    const box = document.getElementById("checkout-summary");
    if (!box) return;

    const cart = getCart();
    if (!cart.length) {
      box.innerHTML = `<p class="empty-cart">Cart is empty</p>`;
      return;
    }

    const sub = cartSubtotal(cart);
    const disc = getDiscount(sub);
    const total = Math.max(0, sub - disc);

    let html = cart
      .map(
        (i) => `
      <div class="cart-item">
        <span class="product-name">${escapeHtml(i.name)} × ${i.qty}</span>
        <p>${formatPeso(i.price * i.qty)}</p>
      </div>`
      )
      .join("");

    html += `
      <div class="cart-total">
        <span>Total</span>
        <p>${formatPeso(total)}</p>
      </div>`;
    box.innerHTML = html;
  }

  let orderFinished = false;

  function buildOrderSnapshot(name, email, method, extras) {
    const extra = extras || {};
    const cart = extra.items || getCart();
    const sub = extra.sub != null ? extra.sub : cartSubtotal(cart);
    const discount = extra.discount != null ? extra.discount : getDiscount(sub);
    const total = extra.total != null ? extra.total : Math.max(0, sub - discount);
    return {
      id: extra.id != null ? extra.id : null,
      orderNumber: extra.orderNumber || "",
      name: name || extra.name || "Customer",
      email: email || extra.email || "",
      method: method || extra.method || "cod",
      items: cart.map((i) => ({
        id: i.id,
        name: i.name,
        image: i.image || "",
        qty: i.qty,
        price: i.price,
      })),
      sub,
      discount,
      total,
      date: extra.date || Date.now(),
    };
  }

  function formatOrderDate(ts) {
    return new Date(ts).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function paymentLabel(order) {
    return "Cash on Delivery (payment due)";
  }

  function setReceiptStatus(message) {
    const el = document.querySelector(".order-receipt-status");
    if (el) el.textContent = message || "";
  }

  /* ---------- EmailJS config ----------
   * 1) Include the SDK in your HTML (e.g. check-out.html), before shop.js:
   *      <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"></script>
   * 2) Fill in your own IDs from https://dashboard.emailjs.com/
   * 3) Your EmailJS template should reference the variable names used in
   *    templateParams below (to_name, to_email, order_number, order_date,
   *    payment, items, subtotal, discount, total, message).
   */
  const EMAILJS_PUBLIC_KEY = "oO7F91jSeX8mEcLvL";
  const EMAILJS_SERVICE_ID = "service_q0wya1h";
  const EMAILJS_TEMPLATE_ID = "template_g5f6mzh";

  let emailjsReady = false;
  function ensureEmailJs() {
    if (emailjsReady) return true;
    if (typeof window.emailjs === "undefined") return false;
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    emailjsReady = true;
    return true;
  }

  async function sendOrderReceipt(order) {
    if (!order || !order.email) {
      setReceiptStatus("No email was provided, so a receipt was not sent.");
      return;
    }

    if (!ensureEmailJs()) {
      setReceiptStatus(
        "The order is complete, but the receipt could not be sent (EmailJS script not loaded)."
      );
      return;
    }

    setReceiptStatus("Sending a receipt to " + order.email + "…");

    const when = formatOrderDate(order.date);
    const paidWith = paymentLabel(order);
    const itemLines = (order.items || [])
      .map((i) => i.name + " × " + i.qty + " — " + formatPeso(i.price * i.qty))
      .join("\n");

    const templateParams = {
      to_name: order.name,
      to_email: order.email,
      order_number: order.orderNumber || "",
      order_date: when,
      payment: paidWith,
      items: itemLines || "(none)",
      subtotal: formatPeso(order.sub),
      discount: formatPeso(order.discount || 0),
      total: formatPeso(order.total),
      message:
        "Hi " +
        order.name +
        ",\n\nThank you for your Unique Arts Apparel order.\n\n" +
        "Order ID: " +
        (order.orderNumber || "Unavailable") +
        "\n\nOrder date: " +
        when +
        "\nPayment: " +
        paidWith +
        "\n\nItems:\n" +
        (itemLines || "(none)") +
        "\n\nSubtotal: " +
        formatPeso(order.sub) +
        "\nDiscount: " +
        formatPeso(order.discount || 0) +
        "\nTotal: " +
        formatPeso(order.total) +
        "\n\nThis is your order receipt.",
    };

    try {
      await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
      setReceiptStatus("A receipt with your order date, items, and payment was sent to " + order.email + ".");
      showToast("Receipt sent to " + order.email);
    } catch (err) {
      setReceiptStatus(
        "The order is complete, but the receipt email could not be sent. Check spam, or try again later."
      );
      console.error("EmailJS send failed:", err);
    }
  }

  function finishOrder(order) {
    if (orderFinished) return;
    orderFinished = true;
    const name = order.name;
    const cartCleared = clearCart();

    const form = document.getElementById("checkout-form");
    const success = document.getElementById("order-success");
    if (form) form.hidden = true;
    if (success) {
      success.hidden = false;
      const heading = success.querySelector("h3");
      if (heading) heading.textContent = "Order placed";
      const copy = success.querySelector(".order-success-copy");
      if (copy) copy.textContent = `Thanks ${name}! Your order is placed. Pay cash on delivery.`;
      const orderNumber = success.querySelector("[data-order-number]");
      if (orderNumber) {
        orderNumber.textContent = order.orderNumber || (order.id ? `#${order.id}` : "Unavailable");
      }
    }
    showToast(cartCleared ? "Order placed — cart cleared" : "Order placed, but the cart could not be cleared.");
    sendOrderReceipt(order);
  }

  async function saveOrder(order, cart) {
    const user = await window.requireAuth();
    if (!user || !user.id || !user.email) {
      throw new Error("Sign in before placing an order.");
    }

    const orderRef = doc(collection(db, "orders"));
    const orderBytes = window.crypto.getRandomValues(new Uint8Array(6));
    const orderNumber = `UAA-${Array.from(orderBytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
    const quantities = new Map();
    for (const item of cart) {
      quantities.set(item.id, (quantities.get(item.id) || 0) + item.qty);
    }

    if (!quantities.size || quantities.size > 50 ||
      [...quantities.values()].some((quantity) => quantity > MAX_PRODUCT_QUANTITY)) {
      throw new Error("The order contains invalid item quantities.");
    }

    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, "users", user.id);
        const userSnapshot = await transaction.get(userRef);
        if (!userSnapshot.exists() || userSnapshot.data().isActive !== true) {
          throw new Error("This account cannot place orders.");
        }

        const orderItems = [];
        let subtotalCents = 0;
        for (const [productId, quantity] of quantities.entries()) {
          const productRef = doc(db, "products", productId);
          const productSnapshot = await transaction.get(productRef);
          if (!productSnapshot.exists()) {
            throw new Error("A product in your cart is no longer available.");
          }

          const product = productSnapshot.data();
          const price = Number(product.price);
          if (!Number.isFinite(price) || price < 0 || product.stockStatus !== "in_stock") {
            throw new Error(`${product.name || "A product"} is out of stock.`);
          }

          const unitPriceCents = Math.round(price * 100);
          subtotalCents += unitPriceCents * quantity;
          orderItems.push({
            productId,
            name: product.name,
            image: product.image || "",
            quantity,
            unitPrice: unitPriceCents / 100,
          });
        }

        const coupon = getCouponCode();
        const discountCents = coupon === "UAA20" ? Math.round(subtotalCents * 0.2) : 0;
        const totalCents = subtotalCents - discountCents;
        if (totalCents < 0 || totalCents > 100000000) {
          throw new Error("The calculated order total is invalid.");
        }

        transaction.set(orderRef, {
          orderNumber,
          userId: user.id,
          customerName: order.name.trim(),
          customerEmail: user.email,
          items: orderItems,
          subtotal: subtotalCents / 100,
          discount: discountCents / 100,
          total: totalCents / 100,
          coupon: coupon || null,
          paymentMethod: "cod",
          paymentStatus: "pending",
          orderStatus: "pending",
          testMode: true,
          createdAt: serverTimestamp(),
        });
      });

      return { id: orderRef.id, orderNumber, date: Date.now() };
    } catch (error) {
      console.error("Firebase could not save the test order:", error);
      throw new Error(error.message || "Could not save the test order.");
    }
  }

  function setupCheckoutForm() {
    const form = document.getElementById("checkout-form");
    if (!form) return;

    form.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => clearInputError(input));
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = (document.getElementById("order-name") || {}).value?.trim() || "";
      const email = (document.getElementById("order-email") || {}).value?.trim() || "";
      const selectedPayment = document.querySelector('input[name="payment"]:checked');
      const method = selectedPayment ? selectedPayment.value : "";

      clearFieldErrors(form);
      setCheckoutError("");
      let ok = true;
      let validationMessage = "";

      if (name.length < 2 || name.length > 60) {
        showFieldError(document.getElementById("order-name"), "Enter a name between 2 and 60 characters.");
        ok = false;
      }
      if (!isValidEmail(email)) {
        showFieldError(document.getElementById("order-email"), "Enter a valid email address (up to 254 characters).");
        ok = false;
      }
      if (method !== "cod") {
        validationMessage = "Cash on Delivery is the only supported payment method.";
        ok = false;
      }

      const cart = getCart();
      if (!cart.length) {
        setCheckoutError("Your cart is empty. Add an in-stock product before checking out.");
        showToast("Cart is empty");
        return;
      }

      if (!ok) {
        setCheckoutError(validationMessage || "Please correct the highlighted fields and try again.");
        return;
      }

      const sub = cartSubtotal(cart);
      const discount = getDiscount(sub);
      const total = Math.max(0, sub - discount);
      const order = buildOrderSnapshot(name, email, method, { items: cart, sub, discount, total });
      orderFinished = false;

      const submit = form.querySelector("button[type='submit']");
      if (submit) submit.disabled = true;
      try {
        Object.assign(order, await saveOrder(order, cart));
        finishOrder(order);
      } catch (error) {
        const message = error.message || "Could not save your order. Please try again.";
        setCheckoutError(message);
        showToast(message);
      } finally {
        if (submit) submit.disabled = false;
      }
    });

  }

  /* ---------- cart page buttons ---------- */
  function setupCartButtons() {
    document.querySelector(".clear-btn")?.addEventListener("click", () => {
      if (!clearCart()) return;
      renderCartPage();
      showToast("Cart cleared");
    });

    document.querySelector(".update-btn")?.addEventListener("click", () => {
      renderCartPage();
      showToast("Cart updated");
    });

    const couponInput = document.getElementById("coupon-code");
    if (couponInput) {
      couponInput.addEventListener("change", () => {
        const code = couponInput.value.trim().toUpperCase();
        try {
          if (code === "UAA20") {
            localStorage.setItem(COUPON_KEY, code);
            showToast("Coupon UAA20 applied (−20%)");
          } else {
            localStorage.removeItem(COUPON_KEY);
            if (code) showToast("Invalid coupon");
          }
        } catch (error) {
          console.error("Could not save coupon selection:", error);
          showToast("Could not save the coupon. Check your browser storage settings.");
        }
        renderCartPage();
      });
    }
  }

  /* ---------- public: add to cart (for product pages) ---------- */
  window.addToCart = async function (product) {
    const currentProduct = product && typeof product.id === "string"
      ? findProduct(product.id)
      : null;
    if (!currentProduct) {
      showToast("Product is unavailable. Refresh the catalog and try again.");
      return;
    }
    if (currentProduct.stockStatus === "out_of_stock") {
      showToast("This product is out of stock.");
      return;
    }
    const quantity = product.qty == null || product.qty === "" ? 1 : Number(product.qty);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PRODUCT_QUANTITY) {
      showToast(`Choose a whole-number quantity from 1 to ${MAX_PRODUCT_QUANTITY}.`);
      return;
    }

    let user;
    try {
      user = await window.requireAuth();
    } catch (error) {
      console.error("Could not verify the current user:", error);
      showToast("Could not verify your account. Try again.");
      return;
    }

    if (!user) {
      if (typeof window.openAuthModal === "function") {
        window.openAuthModal("login", {
          message: "Sign in or create an account before adding products to your cart.",
          onSuccess: () => window.addToCart(product),
        });
      } else {
        const next = window.location.pathname.split("/").pop() + window.location.search;
        window.location.href = "login.html?next=" + encodeURIComponent(next);
      }
      return;
    }

    const cart = getCart();
    const existing = cart.find((item) => item.id === currentProduct.id);
    if (existing && existing.qty + quantity > MAX_PRODUCT_QUANTITY) {
      showToast(`You can add up to ${MAX_PRODUCT_QUANTITY} of this product per order.`);
      return;
    }
    if (existing) existing.qty += quantity;
    else cart.push({ ...currentProduct, qty: quantity });
    if (!saveCart(cart)) return;
    showToast("Added to cart");
  };

  function findProduct(id) {
    return PRODUCTS.find((p) => p.id === id);
  }

  function addProductById(id, qty) {
    const product = findProduct(id);
    if (!product) {
      showToast("Product is not available. Load the catalog first.");
      return;
    }
    return window.addToCart({ id: product.id, qty });
  }

  function productCardHtml(p) {
    const outOfStock = p.stockStatus === "out_of_stock";
    const badge = outOfStock
      ? `<div class="p-status out-of-stock">Out of stock</div>`
      : p.status
      ? `<div class="p-status ${escapeHtml(p.status)}">${escapeHtml(p.status)}</div>`
      : "";
    return `
      <div class="col-lg-3 col-sm-6 mix ${escapeHtml(p.category)}">
        <div class="single-product-item">
          <figure>
            <a href="product-page.html?id=${encodeURIComponent(p.id)}" class="product-image-btn">
              <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">
            </a>
            ${badge}
          </figure>
          <div class="product-text">
            <a href="product-page.html?id=${encodeURIComponent(p.id)}"><h6>${escapeHtml(p.name)}</h6></a>
            <p>${formatPeso(p.price)}</p>
            <button type="button" class="add-to-cart-btn" data-add-id="${escapeHtml(p.id)}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Out of stock" : "Add to cart"}</button>
          </div>
        </div>
      </div>`;
  }

  function sortedProducts(list, sort) {
    const items = list.slice();
    if (sort === "price" || sort === "price-asc") items.sort((a, b) => a.price - b.price);
    else if (sort === "price-desc") items.sort((a, b) => b.price - a.price);
    else if (sort === "newest") items.reverse();
    return items;
  }

  function bindAddButtons(root) {
    (root || document).querySelectorAll("[data-add-id]").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const qtyInput = document.getElementById("product-qty");
        const qty = qtyInput ? qtyInput.value : 1;
        const quantity = qty === "" ? NaN : Number(qty);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PRODUCT_QUANTITY) {
          showToast(`Choose a whole-number quantity from 1 to ${MAX_PRODUCT_QUANTITY}.`);
          if (qtyInput) qtyInput.focus();
          return;
        }
        btn.disabled = true;
        Promise.resolve(addProductById(btn.getAttribute("data-add-id"), quantity))
          .catch((error) => {
            console.error("Could not add the product to the cart:", error);
            showToast("Could not add this product. Please try again.");
          })
          .finally(() => {
            btn.disabled = false;
          });
      });
    });
  }

  function renderProductGrid(container, products) {
    if (!container) return;
    if (!products.length) {
      container.innerHTML = `<div class="col-12"><p class="empty-cart">No products found.</p></div>`;
      return;
    }
    container.innerHTML = products.map(productCardHtml).join("");
    bindAddButtons(container);
  }

  function renderShopPage() {
    const list = document.getElementById("shop-product-list");
    if (!list) return;

    const countEl = document.querySelector(".categories-filter .cf-right span");
    const sortEl = document.querySelector(".categories-filter select.sort");

    function paint() {
      const sort = (sortEl && sortEl.value) || "";
      const items = sortedProducts(PRODUCTS, sort);
      renderProductGrid(list, items);
      if (countEl) countEl.textContent = items.length + " Products";
    }

    if (sortEl) {
      sortEl.addEventListener("change", paint);
    }
    paint();
  }

  function renderHomeProducts() {
    const list = document.getElementById("product-list");
    if (!list) return;
    renderProductGrid(list, PRODUCTS);
    if (window.mixitup && !list.dataset.mixitup) {
      window.mixitup(list);
      list.dataset.mixitup = "1";
    }
  }

  function renderRelatedProducts() {
    const list = document.getElementById("related-product-list");
    if (!list) return;
    const params = new URLSearchParams(window.location.search);
    const currentId = params.get("id") || "uaa-splatter";
    const related = PRODUCTS.filter((p) => p.id !== currentId).slice(0, 4);
    renderProductGrid(list, related);
  }

  function renderProductDetail() {
    const page = document.getElementById("product-detail-page");
    if (!page) return;

    const params = new URLSearchParams(window.location.search);
    if (!PRODUCTS.length) return;
    const requestedId = params.get("id");
    const product = requestedId ? findProduct(requestedId) : PRODUCTS[0];
    if (!product) {
      const content = page.querySelector(".product-content");
      if (content) {
        content.innerHTML = '<p class="empty-cart">Product not found. <a href="categories.html">Browse products</a></p>';
      }
      page.querySelectorAll(".product-img img").forEach((img) => {
        img.hidden = true;
      });
      return;
    }

    const title = page.querySelector(".product-content h2");
    const price = page.querySelector(".pc-meta h5");
    const desc = page.querySelector(".product-content > p");
    const addBtn = page.querySelector("[data-add-id]");
    page.querySelectorAll(".product-img img").forEach((img) => {
      img.src = product.image;
      img.alt = product.name;
    });
    if (title) title.textContent = product.name;
    if (price) price.textContent = formatPeso(product.price);
    if (desc) desc.textContent = product.description;
    page.querySelectorAll(".product-img .p-status").forEach((badge) => {
      if (product.stockStatus === "out_of_stock") {
        badge.className = "p-status out-of-stock";
        badge.textContent = "Out of stock";
        badge.hidden = false;
      } else if (product.status) {
        badge.className = "p-status " + product.status;
        badge.textContent = product.status;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    });
    if (addBtn) {
      const outOfStock = product.stockStatus === "out_of_stock";
      addBtn.setAttribute("data-add-id", product.id);
      addBtn.disabled = outOfStock;
      addBtn.setAttribute("aria-disabled", String(outOfStock));
      addBtn.textContent = outOfStock ? "Out of stock" : "Add to cart";
    }

    const crumb = document.querySelector(".page-breadcrumb .active");
    if (crumb) crumb.textContent = product.name;
  }

  /* ---------- init ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    updateCartCount();
    renderShopPage();
    renderHomeProducts();
    renderProductDetail();
    renderRelatedProducts();
    renderCartPage();
    renderCheckoutSummary();
    setupCheckoutForm();
    setupCartButtons();
    bindAddButtons(document);
    loadProducts();
  });
})();