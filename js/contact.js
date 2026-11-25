const form = document.getElementById("contact-form");

if (form) {
  const formMessage = document.getElementById("contact-form-message");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const fields = [
    { id: "contact-first", label: "First name", min: 2, max: 60 },
    { id: "contact-last", label: "Last name", min: 2, max: 60 },
    { id: "contact-subject", label: "Subject", min: 3, max: 120 },
    { id: "contact-message", label: "Message", min: 10, max: 2000 },
  ];

  function clearFieldError(field) {
    field.removeAttribute("aria-invalid");
    const error = field.nextElementSibling;
    if (error && error.classList.contains("field-error")) error.remove();
  }

  function showFieldError(field, message) {
    field.setAttribute("aria-invalid", "true");
    const error = document.createElement("span");
    error.className = "field-error";
    error.setAttribute("role", "alert");
    error.textContent = message;
    field.insertAdjacentElement("afterend", error);
  }

  form.querySelectorAll("input, textarea").forEach((field) => {
    field.addEventListener("input", () => {
      clearFieldError(field);
      formMessage.hidden = true;
      formMessage.textContent = "";
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.querySelectorAll("input, textarea").forEach(clearFieldError);
    formMessage.hidden = true;
    formMessage.textContent = "";

    let isValid = true;
    fields.forEach(({ id, label, min, max }) => {
      const field = document.getElementById(id);
      const value = field.value.trim();
      if (value.length < min || value.length > max) {
        showFieldError(field, `${label} must contain ${min} to ${max} characters.`);
        isValid = false;
      }
    });

    const email = document.getElementById("contact-email");
    if (email.value.trim().length > 254 || !emailPattern.test(email.value.trim())) {
      showFieldError(email, "Enter a valid email address of up to 254 characters.");
      isValid = false;
    }

    if (!isValid) {
      formMessage.textContent = "Please correct the highlighted fields and try again.";
      formMessage.classList.add("is-error");
      formMessage.hidden = false;
      return;
    }

    formMessage.textContent = "Your message details are valid, but message delivery is not configured on this site yet.";
    formMessage.classList.remove("is-error");
    formMessage.hidden = false;
  });
}
