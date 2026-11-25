const { randomBytes } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();
const couponDiscounts = {
  UAA20: 0.2,
};

exports.createOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before placing an order.");
  }

  const userRef = db.collection("users").doc(request.auth.uid);
  const { items, name, method, coupon } = request.data || {};
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60) {
    throw new HttpsError("invalid-argument", "Enter a valid recipient name.");
  }
  if (method !== "cod") {
    throw new HttpsError("invalid-argument", "Cash on delivery is the only supported payment method.");
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpsError("invalid-argument", "The order must contain between 1 and 50 items.");
  }

  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)) {
      throw new HttpsError("invalid-argument", "The order contains an invalid product.");
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new HttpsError("invalid-argument", "The order contains an invalid quantity.");
    }
    quantities.set(item.id, (quantities.get(item.id) || 0) + item.quantity);
  }

  if (quantities.size > 50 || [...quantities.values()].some((quantity) => quantity > 99)) {
    throw new HttpsError("invalid-argument", "The order contains too many items.");
  }

  const couponCode = typeof coupon === "string" ? coupon.trim().toUpperCase() : "";
  const discountRate = couponCode ? couponDiscounts[couponCode] : 0;
  if (couponCode && discountRate === undefined) {
    throw new HttpsError("invalid-argument", "That coupon code is not valid.");
  }

  const orderRef = db.collection("orders").doc();
  const orderNumber = `UAA-${randomBytes(6).toString("hex").toUpperCase()}`;

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const user = userSnapshot.data();
    if (!userSnapshot.exists || !user || user.isActive !== true) {
      throw new HttpsError("permission-denied", "This account cannot place orders.");
    }

    const orderItems = [];
    let subtotal = 0;

    for (const [productId, quantity] of quantities.entries()) {
      const productRef = db.collection("products").doc(productId);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists) {
        throw new HttpsError("failed-precondition", `Product ${productId} is no longer available.`);
      }

      const product = productSnapshot.data();
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0 || product.stockStatus !== "in_stock") {
        throw new HttpsError("failed-precondition", `${product.name || "A product"} is out of stock.`);
      }

      const lineTotal = Math.round(price * 100) * quantity;
      subtotal += lineTotal;
      orderItems.push({
        productId,
        name: product.name,
        image: product.image || "",
        quantity,
        unitPrice: Math.round(price * 100) / 100,
      });
    }

    const discount = Math.round(subtotal * (discountRate || 0));
    const total = subtotal - discount;
    if (total <= 0 || total > 100000000) {
      throw new HttpsError("failed-precondition", "The calculated order total is invalid.");
    }

    transaction.create(orderRef, {
      orderNumber,
      userId: request.auth.uid,
      customerName: name.trim(),
      customerEmail: request.auth.token.email || user.email || "",
      items: orderItems,
      subtotal: subtotal / 100,
      discount: discount / 100,
      total: total / 100,
      coupon: couponCode || null,
      paymentMethod: "cod",
      paymentStatus: "pending",
      orderStatus: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return { orderId: orderRef.id, orderNumber };
  });
});
