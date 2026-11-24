(() => {
  let activeRecordId = null;
  let activeEquipmentName = "";
  let selectedRecipient = null;
  let searchTimer = null;
  let searchController = null;

  const createDialog = () => {
    let dialog = document.getElementById("borrowTurnOverDialog");
    if (dialog) return dialog;

    const style = document.createElement("style");
    style.textContent = `
      #borrowTurnOverDialog {
        width: min(94vw, 34rem);
        max-height: min(88vh, 42rem);
        padding: 0;
        overflow: hidden;
        color: #ecfdf5;
        background: #071a11;
        border: 1px solid rgba(52, 211, 153, .35);
        border-radius: 1.25rem;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .55);
      }
      #borrowTurnOverDialog::backdrop { background: rgba(2, 10, 6, .78); backdrop-filter: blur(4px); }
      #borrowTurnOverDialog .turnover-shell { display: grid; gap: 1rem; padding: 1.25rem; }
      #borrowTurnOverDialog h2 { margin: 0; color: #a7f3d0; font-size: 1.25rem; font-weight: 800; }
      #borrowTurnOverDialog p { margin: 0; }
      #borrowTurnOverDialog .turnover-equipment { color: #d1fae5; font-size: .9rem; }
      #borrowTurnOverDialog label { display: grid; gap: .45rem; color: #a7f3d0; font-size: .82rem; font-weight: 700; }
      #borrowTurnOverDialog input {
        width: 100%; min-height: 2.8rem; padding: .7rem .85rem; color: #f0fdf4;
        background: #03110a; border: 1px solid rgba(52, 211, 153, .3); border-radius: .75rem;
      }
      #borrowTurnOverDialog input:focus { outline: 2px solid #34d399; outline-offset: 1px; }
      #borrowTurnOverRecipients { display: grid; gap: .5rem; max-height: 15rem; overflow: auto; }
      #borrowTurnOverRecipients button {
        display: grid; gap: .15rem; width: 100%; padding: .75rem .85rem; text-align: left;
        color: #ecfdf5; background: rgba(4, 106, 56, .12); border: 1px solid rgba(52, 211, 153, .18);
        border-radius: .75rem; cursor: pointer;
      }
      #borrowTurnOverRecipients button:hover, #borrowTurnOverRecipients button[aria-pressed="true"] {
        background: rgba(4, 106, 56, .35); border-color: rgba(52, 211, 153, .55);
      }
      #borrowTurnOverRecipients small { color: #a7f3d0; }
      #borrowTurnOverSelected { min-height: 1.25rem; color: #6ee7b7; font-size: .85rem; }
      #borrowTurnOverError { color: #fda4af; font-size: .85rem; }
      #borrowTurnOverDialog .turnover-actions { display: flex; justify-content: flex-end; gap: .65rem; }
      #borrowTurnOverDialog .turnover-actions button {
        min-height: 2.65rem; padding: .65rem 1rem; color: #ecfdf5; font: inherit; font-weight: 750;
        border: 1px solid rgba(52, 211, 153, .3); border-radius: .75rem; cursor: pointer;
      }
      #borrowTurnOverCancel { background: #10251a; }
      #borrowTurnOverSubmit { background: #046a38; }
      #borrowTurnOverSubmit:disabled { cursor: not-allowed; opacity: .5; }
      @media (max-width: 480px) { #borrowTurnOverDialog .turnover-shell { padding: 1rem; } }
    `;
    document.head.append(style);

    dialog = document.createElement("dialog");
    dialog.id = "borrowTurnOverDialog";
    dialog.innerHTML = `
      <form class="turnover-shell" id="borrowTurnOverForm">
        <h2>Turn Over Equipment</h2>
        <p class="turnover-equipment" id="borrowTurnOverEquipment"></p>
        <label for="borrowTurnOverSearch">Find a Student or Instructor</label>
        <input id="borrowTurnOverSearch" type="search" autocomplete="off" placeholder="Search name, Student Number, or user ID">
        <div id="borrowTurnOverRecipients" role="listbox" aria-label="Turn over recipients"></div>
        <p id="borrowTurnOverSelected" aria-live="polite">Select a recipient to continue.</p>
        <p id="borrowTurnOverError" role="alert" hidden></p>
        <div class="turnover-actions">
          <button type="button" id="borrowTurnOverCancel">Cancel</button>
          <button type="submit" id="borrowTurnOverSubmit" disabled>Turn Over</button>
        </div>
      </form>`;
    document.body.append(dialog);

    dialog.querySelector("#borrowTurnOverCancel").addEventListener("click", () => dialog.close());
    dialog.querySelector("#borrowTurnOverSearch").addEventListener("input", (event) => {
      selectedRecipient = null;
      dialog.querySelector("#borrowTurnOverSelected").textContent = "Select a recipient to continue.";
      dialog.querySelector("#borrowTurnOverSubmit").disabled = true;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchRecipients(event.target.value), 250);
    });
    dialog.querySelector("#borrowTurnOverRecipients").addEventListener("click", (event) => {
      const option = event.target.closest("[data-turnover-recipient]");
      if (!option) return;
      selectedRecipient = {
        userId: option.dataset.turnoverRecipient,
        name: option.dataset.recipientName
      };
      dialog.querySelectorAll("[data-turnover-recipient]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button === option));
      });
      dialog.querySelector("#borrowTurnOverSelected").textContent = `Selected: ${selectedRecipient.name}`;
      dialog.querySelector("#borrowTurnOverSubmit").disabled = false;
    });
    dialog.querySelector("#borrowTurnOverForm").addEventListener("submit", submitTurnOver);
    return dialog;
  };

  const showError = (message) => {
    const error = document.getElementById("borrowTurnOverError");
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  };

  const searchRecipients = async (value) => {
    const dialog = createDialog();
    const list = dialog.querySelector("#borrowTurnOverRecipients");
    const query = String(value || "").trim();
    if (searchController) searchController.abort();
    searchController = null;
    list.replaceChildren();
    if (query.length < 2) {
      const hint = document.createElement("p");
      hint.textContent = "Enter at least two characters to search.";
      list.append(hint);
      return;
    }

    searchController = new AbortController();
    const controller = searchController;
    const loading = document.createElement("p");
    loading.textContent = "Searching recipients…";
    list.append(loading);
    try {
      const response = await fetch(`/api/borrow-records/turnover/recipients?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to search recipients.");
      if (controller !== searchController) return;
      list.replaceChildren();
      const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
      if (!recipients.length) {
        const empty = document.createElement("p");
        empty.textContent = "No eligible Student or Instructor found.";
        list.append(empty);
        return;
      }
      recipients.forEach((recipient) => {
        const option = document.createElement("button");
        option.type = "button";
        option.dataset.turnoverRecipient = recipient.userId;
        option.dataset.recipientName = recipient.name;
        option.setAttribute("role", "option");
        option.setAttribute("aria-pressed", "false");
        const name = document.createElement("strong");
        name.textContent = recipient.name;
        const details = document.createElement("small");
        details.textContent = `${recipient.role} · ${recipient.identifier}${recipient.college ? ` · ${recipient.college}` : ""}`;
        option.append(name, details);
        list.append(option);
      });
    } catch (error) {
      if (error.name === "AbortError") return;
      list.replaceChildren();
      showError(error.message || "Unable to search recipients.");
    }
  };

  async function submitTurnOver(event) {
    event.preventDefault();
    if (!activeRecordId || !selectedRecipient) return;
    const dialog = createDialog();
    const submit = dialog.querySelector("#borrowTurnOverSubmit");
    if (window.appDialogs?.confirm) {
      const confirmed = await window.appDialogs.confirm(
        `Turn over ${activeEquipmentName} to ${selectedRecipient.name}? The new recipient will become responsible for this item.`
      );
      if (!confirmed) return;
    }

    submit.disabled = true;
    dialog.querySelector("#borrowTurnOverError").hidden = true;
    try {
      const response = await fetch(`/api/borrow-records/${encodeURIComponent(activeRecordId)}/turn-over`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientUserId: Number(selectedRecipient.userId) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to turn over this equipment.");
      const selected = dialog.querySelector("#borrowTurnOverSelected");
      selected.textContent = `Turned over to ${selectedRecipient.name}. Updating your requests…`;
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      showError(error.message || "Unable to turn over this equipment.");
      submit.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-turn-over-record]");
    if (!button) return;
    activeRecordId = button.dataset.turnOverRecord;
    activeEquipmentName = button.dataset.equipmentName || "this equipment";
    selectedRecipient = null;
    const dialog = createDialog();
    dialog.querySelector("#borrowTurnOverEquipment").textContent = activeEquipmentName;
    dialog.querySelector("#borrowTurnOverSearch").value = "";
    dialog.querySelector("#borrowTurnOverSelected").textContent = "Select a recipient to continue.";
    dialog.querySelector("#borrowTurnOverRecipients").replaceChildren();
    dialog.querySelector("#borrowTurnOverSubmit").disabled = true;
    dialog.querySelector("#borrowTurnOverError").hidden = true;
    dialog.showModal();
    dialog.querySelector("#borrowTurnOverSearch").focus();
    void searchRecipients("");
  });
})();
