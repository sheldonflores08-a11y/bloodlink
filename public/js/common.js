/**
 * public/js/common.js
 * -------------------
 * Small UI helpers shared by every page:
 * toasts, modals, confirm dialogs, formatters, selects.
 */
const UI = {
  /* ---- toasts ---- */
  toast(msg, kind = 'info') {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  },
  okToast(msg) { UI.toast(msg, 'ok'); },
  errToast(msg) { UI.toast(msg, 'err'); },

  /* ---- modal ---- */
  modal(title, bodyHTML, footerHTML) {
    UI.closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.id = 'active-modal';
    back.innerHTML = `
      <div class="modal">
        <header><b>${UI.esc(title)}</b><button class="x-btn" onclick="UI.closeModal()">&times;</button></header>
        <div class="body">${bodyHTML}</div>
        <footer>${footerHTML || ''}</footer>
      </div>`;
    back.addEventListener('click', (e) => { if (e.target === back) UI.closeModal(); });
    document.body.appendChild(back);
    return back;
  },
  closeModal() { const m = document.getElementById('active-modal'); if (m) m.remove(); },

  /* confirm with a promise-style API */
  confirm(title, message) {
    return new Promise((resolve) => {
      UI.modal(title, `<p>${UI.esc(message)}</p>`,
        `<button class="btn ghost" id="cf-no">Cancel</button>
         <button class="btn danger-outline" id="cf-yes">Confirm</button>`);
      document.getElementById('cf-no').onclick = () => { UI.closeModal(); resolve(false); };
      document.getElementById('cf-yes').onclick = () => { UI.closeModal(); resolve(true); };
    });
  },

  /* ---- escaping ---- */
  esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /* ---- formatting ---- */
  fmtDate(d) {
    if (!d) return '-';
    return new Date(d.length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-PH',
      { year: 'numeric', month: 'short', day: 'numeric' });
  },
  fmtDateTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-PH',
      { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  },

  /* status -> badge class map */
  statusBadge(status) {
    const s = String(status || '');
    const map = {
      active: 'green', inactive: 'gray',
      Pending: 'orange', Verified: 'green', Rejected: 'red',
      Available: 'green', Reserved: 'blue', Used: 'gray', Expired: 'red', Unavailable: 'gray',
      Approved: 'green', Processing: 'blue', Completed: 'dark', Cancelled: 'gray',
      Normal: 'blue', Urgent: 'orange', Critical: 'red',
      unread: 'red', read: 'gray'
    };
    const cls = map[s] || 'gray';
    return `<span class="badge ${cls}">${UI.esc(s)}</span>`;
  },

  bloodChip(t, big) {
    return big
      ? `<span class="bt big">${UI.esc(t)}<small>blood</small></span>`
      : `<span class="bt">${UI.esc(t)}</span>`;
  },

  /* fill any <select data-blood-types> with the 8 blood types */
  fillBloodSelects(allOption) {
    const types = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    document.querySelectorAll('select[data-blood-types]').forEach((sel) => {
      const cur = sel.value;
      sel.innerHTML = (allOption || sel.dataset.bloodAll !== undefined
        ? '<option value="ALL">All blood types</option>' : '') +
        types.map((t) => `<option value="${t}">${t}</option>`).join('');
      if (cur) sel.value = cur;
    });
  },

  /* read a form into an object of field-name -> value */
  formValues(form) {
    const out = {};
    for (const el of form.elements) {
      if (el.name) out[el.name] = el.value;
    }
    return out;
  },

  /* build a simple table */
  table(headers, rowsHTML) {
    return `<div class="table-wrap"><table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rowsHTML || `<tr><td colspan="${headers.length}" class="muted" style="text-align:center;padding:24px">No records found.</td></tr>`}</tbody>
    </table></div>`;
  }
};
