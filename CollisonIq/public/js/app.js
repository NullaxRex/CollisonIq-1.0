'use strict';
// UI behaviour that used to live in inline onclick/onchange attributes. Kept in
// one external file so the Content-Security-Policy can forbid inline script.
//   data-action="print"          → window.print()
//   data-copy-target="<elementId>" → copy that element's text to the clipboard
//   <select data-autosubmit>      → submit the parent form on change
//   <form data-confirm="question"> → ask before submitting

document.addEventListener('click', (event) => {
  const print = event.target.closest('[data-action="print"]');
  if (print) {
    window.print();
    return;
  }
  const copy = event.target.closest('[data-copy-target]');
  if (copy) {
    const source = document.getElementById(copy.dataset.copyTarget);
    if (source && navigator.clipboard) {
      navigator.clipboard.writeText(source.textContent.trim()).then(() => {
        const label = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = label; }, 1500);
      }).catch(() => {});
    }
  }
});

document.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-autosubmit]');
  if (select && select.form) select.form.submit();
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.dataset.confirm)) event.preventDefault();
});
