import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const ALLOWED_NEXT = new Set([
  "index.html",
  "categories.html",
  "product-page.html",
  "shopping-cart.html",
  "check-out.html",
  "contact.html",
  "login.html",
  "register.html",
  "admin.html",
]);

let currentUser = null;
let authModalSuccess = null;
let modalReturnFocus = null;

function safeNext(value) {
  if (!value) return "index.html";
  try {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin) return "index.html";
    const page = url.pathname.split("/").pop() || "index.html";
    if (!ALLOWED_NEXT.has(page)) return "index.html";
    return page + url.search;
  } catch {
    return "index.html";
  }
}

function nextFromQuery() {
  return safeNext(new URLSearchParams(window.location.search).get("next"));
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/network-request-failed": "Could not reach Firebase. Check your internet connection.",
    "auth/operation-not-allowed": "Email/password sign-in is disabled. Enable it in Firebase Authentication settings.",
    "auth/too-many-requests": "Too many attempts. Wait a little and try again.",
    "auth/weak-password": "Choose a stronger password.",
  };
  return messages[error.code] || error.message || "The Firebase request failed. Try again.";
}

async function loadUserProfile(firebaseUser, nameOverride) {
  const email = firebaseUser.email || "";
  const fallbackName = email.split("@")[0] || "Account";
  const profileRef = doc(db, "users", firebaseUser.uid);
  let profileSnapshot = await getDoc(profileRef);
  if (!profileSnapshot.exists()) {
    try {
      await setDoc(profileRef, {
        name: nameOverride || firebaseUser.displayName || fallbackName,
        email,
        role: "customer",
        isActive: true,
        createdAt: serverTimestamp(),
      });
      profileSnapshot = await getDoc(profileRef);
    } catch (error) {
      const existingProfile = await getDoc(profileRef);
      if (!existingProfile.exists()) throw error;
      profileSnapshot = existingProfile;
    }
  }

  const profile = profileSnapshot.data();
  if (!profile || profile.isActive === false) {
    await signOut(auth);
    throw new Error("This account is suspended. Contact the store administrator.");
  }

  const name = nameOverride || profile.name || firebaseUser.displayName || fallbackName;
  if (name !== profile.name || email !== profile.email) {
    await updateDoc(profileRef, { name, email });
  }

  return {
    id: firebaseUser.uid,
    name,
    email,
    role: profile.role === "admin" ? "admin" : "customer",
    isActive: profile.isActive !== false,
  };
}

function setFormMessage(element, text, isError) {
  if (!element) return;
  element.hidden = !text;
  element.textContent = text || "";
  element.classList.toggle("is-error", Boolean(isError && text));
}

function isValidEmail(email) {
  return typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayNameOf(user) {
  return user.name || user.email.split("@")[0] || "Account";
}

function renderHeader(user) {
  document.querySelectorAll("[data-auth-nav]").forEach((nav) => {
    if (user) {
      const adminLink = user.role === "admin"
        ? '<a href="admin.html" class="auth-admin-link">Admin dashboard</a>'
        : "";
      nav.innerHTML = `
        <span class="auth-greeting">Hi, ${escapeHtml(displayNameOf(user))}</span>
        ${adminLink}
        <button type="button" class="auth-logout-button" data-auth-logout>Sign out</button>
      `;
    } else {
      nav.innerHTML = `
        <a href="register.html" data-auth-register>Register</a>
        <a href="login.html" class="in" data-auth-signin>Sign in</a>
      `;
    }
  });

  document.querySelectorAll("[data-auth-account]").forEach((link) => {
    link.setAttribute("href", user ? "index.html" : "login.html");
    link.setAttribute("title", user ? `Signed in as ${displayNameOf(user)}` : "Sign in");
    link.setAttribute("aria-label", user ? `Account: ${displayNameOf(user)}` : "Sign in");
    if (user) {
      const name = document.createElement("span");
      name.className = "account-name";
      name.textContent = displayNameOf(user);
      link.replaceChildren(name);
      link.classList.add("account-link-name");
    } else {
      const icon = document.createElement("img");
      icon.src = "img/icons/man.svg";
      icon.alt = "Account";
      link.replaceChildren(icon);
      link.classList.remove("account-link-name");
    }
  });
}

function renderAuthModal(mode, leadText) {
  const modal = document.getElementById("auth-modal");
  const title = modal.querySelector("[data-auth-modal-title]");
  const lead = modal.querySelector("[data-auth-modal-lead]");
  const content = modal.querySelector("[data-auth-modal-content]");
  const registering = mode === "register";

  title.textContent = registering ? "Create your account" : "Sign in";
  lead.textContent = leadText || (registering
    ? "Register to add products to your cart and check out."
    : "Sign in to add products to your cart.");
  content.innerHTML = registering
    ? `
      <form class="contact-form auth-form auth-modal-form" data-auth-modal-form="register" novalidate>
        <input type="text" name="name" placeholder="Full name" autocomplete="name" required minlength="2" maxlength="60">
        <input type="email" name="email" placeholder="E-mail" autocomplete="email" maxlength="254" required>
        <input type="password" name="password" placeholder="Password (min. 6 characters)" autocomplete="new-password" required minlength="6" maxlength="72">
        <input type="password" name="confirm" placeholder="Confirm password" autocomplete="new-password" required minlength="6" maxlength="72">
        <p class="auth-message" data-auth-message hidden></p>
        <div class="text-right">
          <button type="submit">Create account</button>
        </div>
      </form>
      <p class="auth-switch">Already have an account? <a href="#" data-auth-modal-mode="login">Sign in</a></p>
    `
    : `
      <form class="contact-form auth-form auth-modal-form" data-auth-modal-form="login" novalidate>
        <input type="email" name="email" placeholder="E-mail" autocomplete="email" maxlength="254" required>
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required minlength="6" maxlength="72">
        <p class="auth-message" data-auth-message hidden></p>
        <div class="text-right">
          <button type="submit">Sign in</button>
        </div>
      </form>
      <p class="auth-switch">New here? <a href="#" data-auth-modal-mode="register">Create an account</a></p>
    `;

  const form = content.querySelector("[data-auth-modal-form]");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (registering) handleRegister(form);
    else handleLogin(form);
  });
}

function ensureAuthModal() {
  let modal = document.getElementById("auth-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "auth-modal";
  modal.className = "auth-modal-overlay";
  modal.hidden = true;
  modal.setAttribute("data-auth-modal", "");
  modal.innerHTML = `
    <section class="auth-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button type="button" class="auth-modal-close" data-auth-modal-close aria-label="Close">×</button>
      <h2 id="auth-modal-title" data-auth-modal-title></h2>
      <p class="auth-modal-lead" data-auth-modal-lead></p>
      <div data-auth-modal-content></div>
    </section>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-auth-modal-close]")) {
      closeAuthModal();
      return;
    }

    const switchLink = event.target.closest("[data-auth-modal-mode]");
    if (switchLink) {
      event.preventDefault();
      renderAuthModal(switchLink.dataset.authModalMode);
    }
  });
  document.body.appendChild(modal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeAuthModal();
  });
  return modal;
}

function openAuthModal(mode, options) {
  const settings = options || {};
  const modal = ensureAuthModal();
  authModalSuccess = settings.onSuccess || null;
  modalReturnFocus = document.activeElement;
  renderAuthModal(mode === "register" ? "register" : "login", settings.message);
  modal.hidden = false;
  document.body.classList.add("auth-modal-open");
  modal.querySelector("input").focus();
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("auth-modal-open");
  authModalSuccess = null;
  const returnFocus = modalReturnFocus;
  modalReturnFocus = null;
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}

function completeModalAuthentication() {
  const onSuccess = authModalSuccess;
  closeAuthModal();
  if (onSuccess) onSuccess();
}

function bindAuthLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || link.closest("[data-auth-modal]")) return;

    let page;
    try {
      page = new URL(link.href, window.location.href).pathname.split("/").pop();
    } catch {
      return;
    }
    if (page !== "login.html" && page !== "register.html") return;

    event.preventDefault();
    openAuthModal(page === "register.html" ? "register" : "login");
  });
}

function fillCheckout(user) {
  const nameInput = document.getElementById("order-name");
  const emailInput = document.getElementById("order-email");
  if (nameInput && !nameInput.value) nameInput.value = user.name || "";
  if (emailInput) {
    emailInput.value = user.email || "";
    emailInput.readOnly = true;
  }
}

function gateCheckout(user) {
  const form = document.getElementById("checkout-form");
  if (!form) return;
  if (!user) {
    form.hidden = true;
    openAuthModal("login", {
      message: "Sign in or create an account to continue to checkout.",
    });
    return;
  }
  form.hidden = false;
  fillCheckout(user);
}

function preserveNextOnLinks() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return;
  const suffix = "?next=" + encodeURIComponent(next);
  document.querySelectorAll('a[href="login.html"]').forEach((link) => {
    link.setAttribute("href", "login.html" + suffix);
  });
  document.querySelectorAll('a[href="register.html"]').forEach((link) => {
    link.setAttribute("href", "register.html" + suffix);
  });
}

function setupAuthForms() {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  preserveNextOnLinks();

  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleLogin(loginForm);
    });
  }
  if (registerForm) {
    registerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleRegister(registerForm);
    });
  }
}

async function handleLogin(form) {
  const message = form.querySelector("[data-auth-message]");
  const submit = form.querySelector("button[type='submit']");
  const email = form.querySelector('[name="email"]').value.trim();
  const password = form.querySelector('[name="password"]').value;

  if (!email || !password) {
    setFormMessage(message, "Enter your email and password.", true);
    return;
  }
  if (!isValidEmail(email)) {
    setFormMessage(message, "Enter a valid email address.", true);
    return;
  }
  const passwordBytes = new TextEncoder().encode(password).length;
  if (passwordBytes < 6 || passwordBytes > 72) {
    setFormMessage(message, "Password must contain 6 to 72 UTF-8 bytes.", true);
    return;
  }

  submit.disabled = true;
  setFormMessage(message, "Signing in…", false);
  try {
    await authReady;
    const credential = await signInWithEmailAndPassword(auth, email, password);
    applyUser(await loadUserProfile(credential.user));
    if (form.matches("[data-auth-modal-form]")) {
      completeModalAuthentication();
      return;
    }
    window.location.href = nextFromQuery();
  } catch (error) {
    setFormMessage(message, authErrorMessage(error), true);
  } finally {
    submit.disabled = false;
  }
}

async function handleRegister(form) {
  const message = form.querySelector("[data-auth-message]");
  const submit = form.querySelector("button[type='submit']");
  const name = form.querySelector('[name="name"]').value.trim();
  const email = form.querySelector('[name="email"]').value.trim();
  const password = form.querySelector('[name="password"]').value;
  const confirm = form.querySelector('[name="confirm"]').value;

  if (!name || !email || !password) {
    setFormMessage(message, "Fill in name, email, and password.", true);
    return;
  }
  if (name.length < 2 || name.length > 60) {
    setFormMessage(message, "Name must contain 2 to 60 characters.", true);
    return;
  }
  if (!isValidEmail(email)) {
    setFormMessage(message, "Enter a valid email address of up to 254 characters.", true);
    return;
  }
  const passwordBytes = new TextEncoder().encode(password).length;
  if (passwordBytes < 6 || passwordBytes > 72) {
    setFormMessage(message, "Password must contain 6 to 72 UTF-8 bytes.", true);
    return;
  }
  if (password !== confirm) {
    setFormMessage(message, "Passwords do not match.", true);
    return;
  }

  submit.disabled = true;
  setFormMessage(message, "Creating your account…", false);
  try {
    await authReady;
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    applyUser(await loadUserProfile(credential.user, name));
    if (form.matches("[data-auth-modal-form]")) {
      completeModalAuthentication();
      return;
    }
    window.location.href = nextFromQuery();
  } catch (error) {
    setFormMessage(message, authErrorMessage(error), true);
  } finally {
    submit.disabled = false;
  }
}

function applyUser(user) {
  currentUser = user || null;
  window.currentUser = currentUser;
  renderHeader(currentUser);
  gateCheckout(currentUser);
  window.dispatchEvent(new CustomEvent("auth:changed", { detail: { user: currentUser } }));
}

function showSessionError(error) {
  const checkoutForm = document.getElementById("checkout-form");
  if (checkoutForm) {
    const message = document.createElement("p");
    message.className = "auth-message is-error";
    message.textContent = error.message || "Could not check your sign-in. Check the Firebase configuration.";
    checkoutForm.insertAdjacentElement("beforebegin", message);
  }

  document.querySelectorAll("#login-form [data-auth-message], #register-form [data-auth-message]")
    .forEach((element) => {
      setFormMessage(
        element,
        error.message || "Could not connect to Firebase. Check the Firebase configuration.",
        true
      );
    });
}

function bindLogout() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-auth-logout]");
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    try {
      await signOut(auth);
      applyUser(null);
    } catch (error) {
      button.disabled = false;
      window.alert(authErrorMessage(error));
    }
  });
}

async function initializeAuth() {
  const checkoutForm = document.getElementById("checkout-form");
  if (checkoutForm) checkoutForm.hidden = true;

  setupAuthForms();
  bindLogout();
  bindAuthLinks();

  return new Promise((resolve) => {
    let firstChange = true;
    onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        applyUser(firebaseUser ? await loadUserProfile(firebaseUser) : null);
        if (currentUser && (document.getElementById("login-form") || document.getElementById("register-form"))) {
          window.location.replace(nextFromQuery());
        }
      } catch (error) {
        applyUser(null);
        showSessionError(error);
      } finally {
        if (firstChange) {
          firstChange = false;
          resolve();
        }
      }
    });
  });
}

const authReady = initializeAuth();
window.authReady = authReady;
window.requireAuth = async () => {
  await authReady;
  return currentUser;
};
window.openAuthModal = openAuthModal;
