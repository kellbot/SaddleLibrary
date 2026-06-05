(function () {
  const config = window.SADDLE_CONFIG || {};

  function getContactEndpoint() {
    if (config.contactProxyUrl) {
      return config.contactProxyUrl;
    }

    if (config.checkoutProxyUrl && config.checkoutProxyUrl.includes("/api/checkouts")) {
      return config.checkoutProxyUrl.replace("/api/checkouts", "/api/contact");
    }

    if (config.proxyUrl && config.proxyUrl.includes("/api/saddles")) {
      return config.proxyUrl.replace("/api/saddles", "/api/contact");
    }

    return "";
  }

  function createFooterAndDialog() {
    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="footer-content">
        <p>Philadelphia Saddle Library</p>
        <button type="button" id="openContactButton" class="contact-button">Contact Us</button>
      </div>
    `;

    const dialog = document.createElement("dialog");
    dialog.id = "contactDialog";
    dialog.className = "contact-dialog";
    dialog.innerHTML = `
      <form id="contactForm" method="dialog" class="contact-form">
        <h2>Contact Us</h2>
        <p class="contact-summary">Questions, updates, or donation inquiries.</p>

        <label>
          Your Name
          <input name="contactName" required />
        </label>

        <label>
          Email
          <input name="contactEmail" type="email" required />
        </label>

        <label>
          Message
          <textarea name="contactMessage" rows="4" required></textarea>
        </label>

        <div class="hp-field" aria-hidden="true">
          <label>
            Leave this field empty
            <input name="website" tabindex="-1" autocomplete="off" />
          </label>
        </div>

        <input type="hidden" name="startedAtMs" id="contactStartedAtMs" />

        <div id="contactTurnstileContainer"></div>
        <p id="contactFormStatus" class="contact-form-status" aria-live="polite"></p>

        <div class="contact-actions">
          <button type="button" id="cancelContactButton">Cancel</button>
          <button type="submit" id="submitContactButton">Send Message</button>
        </div>
      </form>
    `;

    document.body.appendChild(footer);
    document.body.appendChild(dialog);
  }

  function setContactStatus(message, isError) {
    const statusEl = document.querySelector("#contactFormStatus");
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.style.color = isError ? "crimson" : "";
  }

  function initContactForm() {
    createFooterAndDialog();

    const endpoint = getContactEndpoint();
    const openButton = document.querySelector("#openContactButton");
    const cancelButton = document.querySelector("#cancelContactButton");
    const submitButton = document.querySelector("#submitContactButton");
    const dialog = document.querySelector("#contactDialog");
    const form = document.querySelector("#contactForm");
    const startedAt = document.querySelector("#contactStartedAtMs");
    const turnstileContainer = document.querySelector("#contactTurnstileContainer");
    let widgetId = null;

    function openDialog() {
      startedAt.value = String(Date.now());
      setContactStatus("", false);

      const siteKey = config.turnstileSiteKey;
      if (siteKey && window.turnstile && widgetId === null) {
        widgetId = window.turnstile.render(turnstileContainer, {
          sitekey: siteKey,
          theme: "auto",
        });
      }

      if (window.turnstile && widgetId !== null) {
        window.turnstile.reset(widgetId);
      }

      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "open");
      }
    }

    function closeDialog() {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }

    openButton.addEventListener("click", openDialog);
    cancelButton.addEventListener("click", closeDialog);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!endpoint) {
        setContactStatus("Contact endpoint is not configured", true);
        return;
      }

      const formData = new FormData(form);
      const payload = {
        name: String(formData.get("contactName") || "").trim(),
        email: String(formData.get("contactEmail") || "").trim(),
        message: String(formData.get("contactMessage") || "").trim(),
        website: String(formData.get("website") || "").trim(),
        startedAtMs: Number(formData.get("startedAtMs") || 0),
        turnstileToken: String(formData.get("cf-turnstile-response") || "").trim(),
      };

      if (!payload.name || !payload.email || !payload.message) {
        setContactStatus("Name, email, and message are required", true);
        return;
      }

      if (config.turnstileSiteKey && !payload.turnstileToken) {
        setContactStatus("Please complete the anti-spam check", true);
        return;
      }

      submitButton.disabled = true;
      setContactStatus("Sending...", false);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json().catch(function () {
          return {};
        });

        if (!response.ok) {
          throw new Error(result.error || "Could not send message");
        }

        form.reset();
        closeDialog();
        alert("Thanks! Your message has been sent.");
      } catch (error) {
        setContactStatus(error.message || "Could not send message", true);
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initContactForm);
  } else {
    initContactForm();
  }
})();
