"use strict";

/* ---------- Configuration ---------- */

/** Attendance below this percentage makes a subject's progress bar red. */
const ELIGIBILITY_PERCENTAGE = 75;
const FINE_FREE_PERCENTAGE = 85;

/**
 * Reference thresholds shown in every subject's details.
 * Each value must lie within the target range accepted by the core.
 */
const POLICY_THRESHOLDS = [
  { label: "Exam eligibility", value: ELIGIBILITY_PERCENTAGE },
  { label: "Fine-free", value: FINE_FREE_PERCENTAGE },
];

const ICONS = {
  edit: "\uE70F",
  remove: "\uE74D",
  cancel: "\uE711",
  chevron: "\uE70D",
  aboutClosed: "\uEB51",
  aboutOpen: "\uEB52",
};

/* ---------- State and DOM references ---------- */

const state = {
  core: null,           // initialized WebAssembly module
  register: null,       // AttendanceRegister instance
  target: 0,            // current target attendance percentage
  subjects: [],         // plain-object snapshot of the register
  expanded: new Set(),  // names of subjects whose details are open
  editingName: null,    // subject being edited, or null when adding
  renaming: false,      // whether the name field is unlocked in the edit dialog
  deletingName: null,   // subject awaiting delete confirmation
};

const touched = { name: false, attended: false, conducted: false };

const $ = (id) => document.getElementById(id);
const dom = {
  startupError: $("startup-error"),
  list: $("subject-list"),
  targetButton: $("target-button"),
  targetValue: $("target-value"),
  addButton: $("add-subject-button"),
  aboutButton: $("about-button"),
  aboutIcon: $("about-icon"),
  aboutDialog: $("about-dialog"),
  aboutEligibility: $("about-eligibility"),

  subjectDialog: $("subject-dialog"),
  subjectForm: $("subject-form"),
  subjectTitle: $("subject-dialog-title"),
  name: $("subject-name"),
  renameButton: $("rename-button"),
  renameIcon: $("rename-icon"),
  attended: $("classes-attended"),
  conducted: $("classes-conducted"),
  nameError: $("subject-name-error"),
  countsError: $("subject-counts-error"),

  deleteDialog: $("delete-dialog"),
  deleteForm: $("delete-form"),
  deleteMessage: $("delete-message"),
  deleteError: $("delete-error"),

  targetDialog: $("target-dialog"),
  targetForm: $("target-form"),
  targetInput: $("target-input"),
  targetHint: $("target-hint"),
  targetError: $("target-error"),
};

/* ---------- Helpers ---------- */

function createElement(tag, { className, text, attributes } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const createIcon = (glyph, extraClass = "") =>
  createElement("span", { className: `icon ${extraClass}`.trim(), text: glyph, attributes: { "aria-hidden": "true" } });

const formatPercent = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}%` : "–");

const formatTarget = (value) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

/** Normalizes an OperationResult or MetricsResult returned by the core. */
function toOutcome(result) {
  return { ok: result.status === true, code: result.code, message: result.message };
}

function hasErrorCode(outcome, codeName) {
  return outcome.code.value === state.core.ErrorCodes[codeName].value;
}

/** Decides which part of the subject form an error belongs to. */
function errorArea(outcome) {
  const nameErrors = ["ESN", "SAP", "SNP"];
  return nameErrors.some((codeName) => hasErrorCode(outcome, codeName)) ? "name" : "counts";
}

function showBanner(message) {
  dom.startupError.textContent = message;
  dom.startupError.hidden = false;
}

function progressStatus(subject) {
  if (subject.current < ELIGIBILITY_PERCENTAGE) return "critical";
  return subject.required === 0 ? "met" : "warning";
}

/** Copies everything the UI needs out of the core and releases every native handle. */
function readSubjects() {
  const vector = state.register.subjects();
  const subjects = [];
  try {
    for (let index = 0; index < vector.size(); index++) {
      const subject = vector.get(index);
      try {
        const name = subject.subjectName();
        subjects.push({
          name,
          attended: subject.classesAttended(),
          conducted: subject.classesConducted(),
          current: subject.currentPercentage(),
          required: subject.requiredPercentage(),
          excess: subject.excessPercentage(),
          needed: subject.classesNeeded(),
          overflow: subject.classOverflow(),
          thresholds: POLICY_THRESHOLDS.map((threshold) => {
            const result = state.register.metricsFor(name, threshold.value);
            return { ...threshold, metrics: result.status ? result.metrics : null };
          }),
        });
      } finally {
        subject.delete();
      }
    }
  } finally {
    vector.delete();
  }
  return subjects;
}

/* ---------- Rendering ---------- */

function refresh() {
  state.subjects = readSubjects();
  dom.targetValue.textContent = formatTarget(state.target);
  renderSubjects();
}

function describeThreshold(metrics) {
  if (!metrics) return "–";
  if (metrics.classesNeeded > 0) return `Attend ${metrics.classesNeeded} more`;
  if (metrics.classesOverflow > 0) return `Can miss ${metrics.classesOverflow}`;
  return "Exactly at threshold";
}

function buildCard(subject, index) {
  const expanded = state.expanded.has(subject.name);
  const bodyId = `subject-details-${index}`;
  const width = Number.isFinite(subject.current) ? Math.min(100, Math.max(0, subject.current)) : 0;

  const fill = createElement("span", { className: "progress-fill" });
  fill.style.width = `${width}%`;

  const toggle = createElement(
    "button",
    {
      className: "card-toggle",
      attributes: {
        type: "button",
        "data-action": "toggle",
        "data-subject": subject.name,
        "aria-expanded": String(expanded),
        "aria-controls": bodyId,
      },
    },
    createElement(
      "span",
      { className: "card-title-row" },
      createElement("span", { className: "card-name", text: subject.name }),
      createIcon(ICONS.chevron, "chevron"),
    ),
    createElement(
      "span",
      { className: "card-progress-row" },
      createElement("span", { className: "progress", attributes: { "aria-hidden": "true" } }, fill),
      createElement("span", { className: "progress-value", text: formatPercent(subject.current) }),
    ),
  );

  const actionButton = (action, glyph, label, variant = "") =>
    createElement(
      "button",
      {
        className: `icon-button icon-button-small ${variant}`.trim(),
        attributes: {
          type: "button",
          "data-action": action,
          "data-subject": subject.name,
          title: label,
          "aria-label": `${label}: ${subject.name}`,
        },
      },
      createIcon(glyph),
    );

  const row = (label, value) => [createElement("dt", { text: label }), createElement("dd", { text: value })];

  const countItem = (label, value) =>
    createElement("span", { className: "card-count" }, `${label}: `, createElement("strong", { text: String(value) }));

  const body = createElement(
    "div",
    { className: "card-body", attributes: { id: bodyId } },
    createElement(
      "dl",
      {},
      ...row("Current", formatPercent(subject.current)),
      ...row("Shortfall to target", formatPercent(subject.required)),
      ...row("Above target", formatPercent(subject.excess)),
      ...row("Classes to attend", String(subject.needed)),
      ...row("Classes you can miss", String(subject.overflow)),
    ),
    createElement("h3", { text: "Policy thresholds" }),
    createElement(
      "dl",
      {},
      ...subject.thresholds.flatMap((threshold) =>
        row(`${threshold.label} (${threshold.value}%)`, describeThreshold(threshold.metrics)),
      ),
    ),
  );
  body.hidden = !expanded;

  const header = createElement(
    "div",
    { className: "card-header" },
    toggle,
    createElement(
      "div",
      { className: "card-footer" },
      createElement(
        "p",
        { className: "card-counts" },
        countItem("Attended", subject.attended),
        countItem("Conducted", subject.conducted),
      ),
      createElement(
        "div",
        { className: "card-buttons" },
        actionButton("edit", ICONS.edit, "Edit subject"),
        actionButton("delete", ICONS.remove, "Delete subject", "icon-button-danger"),
      ),
    ),
  );

  return createElement(
    "article",
    { className: `card status-${progressStatus(subject)}${expanded ? " expanded" : ""}` },
    header,
    body,
  );
}

function renderSubjects() {
  dom.list.replaceChildren();

  if (state.subjects.length === 0) {
    dom.list.append(
      createElement("p", { className: "empty-state", text: "No subjects yet. Use the + button to add one." }),
    );
    return;
  }

  state.subjects.forEach((subject, index) => dom.list.append(buildCard(subject, index)));
}

function toggleCard(button, subjectName) {
  const card = button.closest(".card");
  const body = card.querySelector(".card-body");
  const expanded = button.getAttribute("aria-expanded") !== "true";

  button.setAttribute("aria-expanded", String(expanded));
  card.classList.toggle("expanded", expanded);
  body.hidden = !expanded;

  if (expanded) state.expanded.add(subjectName);
  else state.expanded.delete(subjectName);
}

/* ---------- Subject form ---------- */

function clearSubjectErrors() {
  for (const element of [dom.nameError, dom.countsError]) {
    element.hidden = true;
    element.textContent = "";
  }
  for (const input of [dom.name, dom.attended, dom.conducted]) input.removeAttribute("aria-invalid");
}

function showSubjectError(area, message) {
  if (area === "name") {
    dom.nameError.textContent = message;
    dom.nameError.hidden = false;
    dom.name.setAttribute("aria-invalid", "true");
  } else {
    dom.countsError.textContent = message;
    dom.countsError.hidden = false;
    dom.attended.setAttribute("aria-invalid", "true");
    dom.conducted.setAttribute("aria-invalid", "true");
  }
}

/** Reads both count fields, rejecting anything that is not a whole, non-negative number. */
function readCounts() {
  const attended = dom.attended.valueAsNumber;
  const conducted = dom.conducted.valueAsNumber;
  const isWholeNumber = (value) => Number.isInteger(value) && value >= 0;

  if (!isWholeNumber(attended) || !isWholeNumber(conducted)) {
    return { error: "Enter whole numbers of 0 or more." };
  }
  return { attended, conducted };
}

/**
 * Runs the core validators and reports the first problem in each area.
 * Without `force`, a field is only checked once the user has interacted with it,
 * so a fresh form does not open with errors.
 * Returns true when everything that was checked is valid.
 */
function validateSubjectForm({ force = false } = {}) {
  clearSubjectErrors();
  let valid = true;

  if (force || touched.name) {
    const nameOutcome = toOutcome(state.core.validateSubjectName(dom.name.value));
    if (!nameOutcome.ok) {
      showSubjectError("name", nameOutcome.message);
      valid = false;
    }
  }

  if (force || (touched.attended && touched.conducted)) {
    const counts = readCounts();
    if (counts.error) {
      showSubjectError("counts", counts.error);
      valid = false;
    } else {
      // Values beyond the limit are clamped so the core reports "too large" instead of overflowing its integer type.
      const clamp = (value) => Math.min(value, state.core.MAX_CLASSES + 1);
      const countsOutcome = toOutcome(state.core.validateClassesCount(clamp(counts.attended), clamp(counts.conducted)));
      if (!countsOutcome.ok) {
        showSubjectError("counts", countsOutcome.message);
        valid = false;
      }
    }
  }

  return valid;
}

function updateRenameButton() {
  dom.renameIcon.textContent = state.renaming ? ICONS.cancel : ICONS.edit;
  const label = state.renaming ? "Cancel rename" : "Rename subject";
  dom.renameButton.title = label;
  dom.renameButton.setAttribute("aria-label", label);
}

function toggleRename() {
  if (!state.renaming) {
    state.renaming = true;
    dom.name.readOnly = false;
    updateRenameButton();
    dom.name.focus();
    dom.name.select();
    return;
  }

  // Cancel: restore the original name and lock the field again.
  state.renaming = false;
  dom.name.value = state.editingName;
  dom.name.readOnly = true;
  touched.name = false;
  updateRenameButton();
  validateSubjectForm();
}

function openSubjectDialog(subject) {
  state.editingName = subject ? subject.name : null;
  state.renaming = false;
  touched.name = touched.attended = touched.conducted = false;
  clearSubjectErrors();

  dom.subjectTitle.textContent = subject ? "Edit subject" : "Add subject";
  dom.name.value = subject ? subject.name : "";
  dom.name.readOnly = Boolean(subject); // locked until the user chooses to rename
  dom.renameButton.hidden = !subject;
  updateRenameButton();
  dom.attended.value = subject ? subject.attended : 0;
  dom.conducted.value = subject ? subject.conducted : 0;

  dom.subjectDialog.showModal();
  (subject ? dom.attended : dom.name).focus();
}

function handleSubjectSubmit(event) {
  event.preventDefault();
  if (!validateSubjectForm({ force: true })) return;

  const name = dom.name.value.trim();
  const { attended, conducted } = readCounts();
  const isEditing = state.editingName !== null;

  const outcome = toOutcome(
    isEditing
      ? state.register.edit(state.editingName, name, attended, conducted)
      : state.register.insert(name, attended, conducted),
  );

  if (!outcome.ok) {
    clearSubjectErrors();
    showSubjectError(errorArea(outcome), outcome.message);
    return;
  }

  // Keep the card open after a rename.
  if (isEditing && name !== state.editingName && state.expanded.delete(state.editingName)) {
    state.expanded.add(name);
  }

  dom.subjectDialog.close();
  refresh();
}

/* ---------- Delete dialog ---------- */

function openDeleteDialog(subject) {
  state.deletingName = subject.name;
  dom.deleteMessage.textContent = `Delete “${subject.name}”? This cannot be undone.`;
  dom.deleteError.hidden = true;
  dom.deleteError.textContent = "";
  dom.deleteDialog.showModal();
}

function handleDeleteSubmit(event) {
  event.preventDefault();

  const outcome = toOutcome(state.register.remove(state.deletingName));
  if (!outcome.ok) {
    dom.deleteError.textContent = outcome.message;
    dom.deleteError.hidden = false;
    return;
  }

  state.expanded.delete(state.deletingName);
  state.deletingName = null;
  dom.deleteDialog.close();
  refresh();
}

/* ---------- Target form ---------- */

function clearTargetError() {
  dom.targetError.hidden = true;
  dom.targetError.textContent = "";
  dom.targetInput.removeAttribute("aria-invalid");
}

function showTargetError(message) {
  dom.targetError.textContent = message;
  dom.targetError.hidden = false;
  dom.targetInput.setAttribute("aria-invalid", "true");
}

/** Returns the entered percentage, or null after showing an error. */
function validateTarget() {
  clearTargetError();
  const value = dom.targetInput.valueAsNumber;

  if (!Number.isFinite(value)) {
    showTargetError("Enter a valid number.");
    return null;
  }

  const outcome = toOutcome(state.core.validateDesiredPercentage(value));
  if (!outcome.ok) {
    showTargetError(outcome.message);
    return null;
  }
  return value;
}

function openTargetDialog() {
  clearTargetError();
  dom.targetInput.value = state.target;
  dom.targetDialog.showModal();
  dom.targetInput.select();
}

function handleTargetSubmit(event) {
  event.preventDefault();

  const value = validateTarget();
  if (value === null) return;

  const outcome = toOutcome(state.register.setDesiredPercentage(value));
  if (!outcome.ok) {
    showTargetError(outcome.message);
    return;
  }

  state.target = value;
  dom.targetDialog.close();
  refresh();
}

/* ---------- Setup ---------- */

/** Wiring that does not depend on the WebAssembly module. */
function bindStaticEvents() {
  dom.aboutEligibility.textContent = `${ELIGIBILITY_PERCENTAGE}%`;

  dom.aboutButton.addEventListener("click", () => {
    dom.aboutIcon.textContent = ICONS.aboutOpen;
    dom.aboutDialog.showModal();
  });
  dom.aboutDialog.addEventListener("close", () => {
    dom.aboutIcon.textContent = ICONS.aboutClosed;
  });

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }
}

function configureInputs() {
  const { MAX_CLASSES, MIN_DESIRED_PERCENTAGE, MAX_DESIRED_PERCENTAGE } = state.core;

  dom.attended.max = MAX_CLASSES;
  dom.conducted.max = MAX_CLASSES;
  dom.targetInput.min = MIN_DESIRED_PERCENTAGE;
  dom.targetInput.max = MAX_DESIRED_PERCENTAGE;
  dom.targetHint.textContent = `Allowed range: ${MIN_DESIRED_PERCENTAGE}% to ${MAX_DESIRED_PERCENTAGE}%.`;
}

function bindApplicationEvents() {
  dom.addButton.addEventListener("click", () => openSubjectDialog(null));
  dom.targetButton.addEventListener("click", openTargetDialog);
  dom.renameButton.addEventListener("click", toggleRename);

  // Keyboard shortcut: N opens "Add subject" unless the user is typing or a dialog is open.
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "n" || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (dom.addButton.disabled || document.querySelector("dialog[open]")) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;

    event.preventDefault();
    openSubjectDialog(null);
  });

  dom.subjectForm.addEventListener("submit", handleSubjectSubmit);
  dom.deleteForm.addEventListener("submit", handleDeleteSubmit);
  dom.targetForm.addEventListener("submit", handleTargetSubmit);

  dom.name.addEventListener("input", () => {
    touched.name = true;
    validateSubjectForm();
  });
  for (const [input, key] of [[dom.attended, "attended"], [dom.conducted, "conducted"]]) {
    input.addEventListener("input", () => {
      touched[key] = true;
      validateSubjectForm();
    });
  }
  dom.targetInput.addEventListener("input", validateTarget);

  dom.list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const name = button.dataset.subject;
    if (button.dataset.action === "toggle") {
      toggleCard(button, name);
      return;
    }

    const subject = state.subjects.find((item) => item.name === name);
    if (!subject) return;

    if (button.dataset.action === "edit") openSubjectDialog(subject);
    else openDeleteDialog(subject);
  });
}

async function initialize() {
  bindStaticEvents();

  try {
    if (typeof ACalcModule !== "function") {
      throw new Error("The WebAssembly module was not found. Check that build-wasm/acalc.js loaded.");
    }

    state.core = await ACalcModule();
    state.register = new state.core.AttendanceRegister();
    state.target = state.core.DESIRED_PERCENTAGE;

    configureInputs();
    bindApplicationEvents();
    dom.addButton.disabled = false;
    dom.targetButton.disabled = false;
    refresh();
  } catch (error) {
    console.error("Initialization failed:", error);
    showBanner(`The application could not start: ${error.message}`);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
