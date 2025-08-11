// ==============================
// Tracker (TypeScript) – Supabase auth + per‑user storage
// ==============================

// ----------- Auth helpers (Supabase is injected via HTML) -----------
type SBUser = { id: string } | null;

async function signUpWithPassword(email: string, password: string) {
  const { data, error } = await (window as any).supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signInWithPassword(email: string, password: string) {
  const { data, error } = await (window as any).supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signInWithEmail(email: string) {
  const { error } = await (window as any).supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href }
  });
  if (error) throw error;
}

async function sendPasswordReset(email: string) {
  const { error } = await (window as any).supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname
  });
  if (error) throw error;
}

async function finishPasswordReset(newPassword: string) {
  const { data, error } = await (window as any).supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

async function getCurrentUser(): Promise<SBUser> {
  const { data } = await (window as any).supabase.auth.getUser();
  return data.user ? { id: data.user.id } : null;
}

function onAuthStateChanged(handler: (u: SBUser) => void) {
  const supabase = (window as any).supabase;
  supabase.auth.onAuthStateChange(async () => {
    handler(await getCurrentUser());
  });
}

// ----------- Time utils -----------
function parseTime(str: string): number {
  const parts = str.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error("Invalid time format");
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// Night bonus minutes: 20:00–06:00, subtracting pause (placed mid-shift)
function calcNightMinutes(start: number, end: number, pauseMin: number): number {
  if (end < start) end += 1440; // overnight shift
  const totalWorked = end - start;
  if (totalWorked <= 0) return 0;

  const pauseStart = start + Math.floor(totalWorked / 2) - Math.floor(pauseMin / 2);
  const pauseEnd = pauseStart + pauseMin;

  let nightMinutes = 0;
  for (let t = start; t < end; t++) {
    if (t >= pauseStart && t < pauseEnd) continue;
    const minuteOfDay = t % 1440;
    if (minuteOfDay < 360 || minuteOfDay >= 1200) nightMinutes++;
  }
  return nightMinutes;
}

// ----------- Types -----------
type Entry = {
  date: string; // YYYY-MM-DD
  type: "normal" | "vacation" | "sick";
  workedMinutes: number;
  nightMinutes: number;
};

// ----------- Cloud storage (Supabase) -----------
let currentUserId: string | null = null;
let entriesCache: Entry[] = [];

async function refreshEntries(): Promise<void> {
  if (!currentUserId) { entriesCache = []; return; }
  const { data, error } = await (window as any).supabase
    .from("entries")
    .select("*")
    .eq("user_id", currentUserId)
    .order("date", { ascending: true });

  if (error) { console.error(error); entriesCache = []; return; }

  entriesCache = (data as any[]).map(r => ({
    date: r.date,
    type: r.type,
    workedMinutes: r.worked_minutes,
    nightMinutes: r.night_minutes
  }));
}

async function upsertEntry(entry: Entry): Promise<void> {
  if (!currentUserId) return;
  const { error } = await (window as any).supabase.from("entries").upsert({
    user_id: currentUserId,
    date: entry.date,
    type: entry.type,
    worked_minutes: entry.workedMinutes,
    night_minutes: entry.nightMinutes
  });
  if (error) throw error;
}

async function deleteEntryByDate(dateISO: string): Promise<void> {
  if (!currentUserId) return;
  const { error } = await (window as any).supabase
    .from("entries")
    .delete()
    .eq("user_id", currentUserId)
    .eq("date", dateISO);
  if (error) throw error;
}

// Vacation allowance (local for now)
function loadAllowance(): number {
  const raw = localStorage.getItem("vacAllowance");
  const n = raw ? parseInt(raw) : 30;
  return Number.isFinite(n) ? n : 30;
}
function saveAllowance(n: number) {
  localStorage.setItem("vacAllowance", String(n));
}

// ----------- DOM Setup -----------
const form = document.getElementById("workForm") as HTMLFormElement;
const dayType = document.getElementById("dayType") as HTMLSelectElement;
const timeInputs = document.getElementById("timeInputs") as HTMLDivElement;

const workedTime = document.getElementById("workedTime") as HTMLSpanElement;
const nightTime = document.getElementById("nightTime") as HTMLSpanElement;
const infoMessage = document.getElementById("infoMessage") as HTMLSpanElement;

const historyTable = document.querySelector("#historyTable tbody") as HTMLTableSectionElement | null;

const monthOnly = document.getElementById("monthOnly") as HTMLSelectElement;
const yearPicker = document.getElementById("yearPicker") as HTMLInputElement;
const vacAllowanceInput = document.getElementById("vacAllowance") as HTMLInputElement;
const saveAllowanceBtn = document.getElementById("saveAllowanceBtn") as HTMLButtonElement;

const sumWorked = document.getElementById("sumWorked") as HTMLSpanElement;
const sumNight = document.getElementById("sumNight") as HTMLSpanElement;
const sumDaysNormal = document.getElementById("sumDaysNormal") as HTMLSpanElement;
const sumDaysVacation = document.getElementById("sumDaysVacation") as HTMLSpanElement;
const sumDaysSick = document.getElementById("sumDaysSick") as HTMLSpanElement;
const sumVacUsed = document.getElementById("sumVacUsed") as HTMLSpanElement;
const sumVacRemaining = document.getElementById("sumVacRemaining") as HTMLSpanElement;

// Auth/UI bits
const loginCard = document.getElementById("loginCard") as HTMLDivElement | null;

// Date quick controls
const workDateInput = document.getElementById("workDate") as HTMLInputElement;
const openCalendarBtn = document.getElementById("openCalendarBtn") as HTMLButtonElement;
const todayBtn = document.getElementById("todayBtn") as HTMLButtonElement;
const yesterdayBtn = document.getElementById("yesterdayBtn") as HTMLButtonElement;
const minusDayBtn = document.getElementById("minusDayBtn") as HTMLButtonElement;
const plusDayBtn = document.getElementById("plusDayBtn") as HTMLButtonElement;

// Month nav
const prevMonthBtn = document.getElementById("prevMonthBtn") as HTMLButtonElement;
const nextMonthBtn = document.getElementById("nextMonthBtn") as HTMLButtonElement;

// Calendar & drawer
const calendarGrid = document.getElementById("calendarGrid") as HTMLDivElement | null;
const dayDrawer = document.getElementById("dayDrawer") as HTMLDivElement | null;
const drawerClose = document.getElementById("drawerClose") as HTMLButtonElement | null;
const drawerDate = document.getElementById("drawerDate") as HTMLHeadingElement | null;
const drawerBody = document.getElementById("drawerBody") as HTMLDivElement | null;
const drawerEdit = document.getElementById("drawerEdit") as HTMLButtonElement | null;
const drawerDelete = document.getElementById("drawerDelete") as HTMLButtonElement | null;

// Year dropdown grid (optional)
const yearDropdownBtn = document.getElementById("yearDropdownBtn") as HTMLButtonElement | null;
const yearDropdown = document.getElementById("yearDropdown") as HTMLDivElement | null;
const yearLabel = document.getElementById("yearLabel") as HTMLSpanElement | null;
const yearRangeLabel = document.getElementById("yearRangeLabel") as HTMLSpanElement | null;
const yearGrid = document.getElementById("yearGrid") as HTMLDivElement | null;
const prevDecadeBtn = document.getElementById("prevDecadeBtn") as HTMLButtonElement | null;
const nextDecadeBtn = document.getElementById("nextDecadeBtn") as HTMLButtonElement | null;

// ---- Force startup to current month/year ----
function setMonthYearToToday(): void {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");

  yearPicker.value = y;

  if (monthOnly) {
    const idx = Array.from(monthOnly.options).findIndex(o => o.value === m);
    if (idx >= 0) monthOnly.selectedIndex = idx;
    monthOnly.value = m;
  }

  if (yearLabel) yearLabel.textContent = y;
}
if (yearLabel) yearLabel.textContent = yearPicker.value;

// ----------- History Rendering (uses entriesCache) -----------
async function renderHistory(): Promise<void> {
  if (!historyTable) return;
  const entries = [...entriesCache].sort((a, b) => b.date.localeCompare(a.date));
  historyTable.innerHTML = "";

  for (const entry of entries) {
    const row = document.createElement("tr");
    const typeLabel =
      entry.type === "normal" ? "Normal" :
      entry.type === "vacation" ? "Vacation" : "Sick Leave";

    row.innerHTML = `
      <td>${entry.date}</td>
      <td>${typeLabel}</td>
      <td>${formatTime(entry.workedMinutes)}</td>
      <td>${formatTime(entry.nightMinutes)}</td>
      <td>
        <button class="edit-btn" data-date="${entry.date}">✏️</button>
        <button class="delete-btn" data-date="${entry.date}">🗑️</button>
      </td>
    `;
    historyTable.appendChild(row);

    row.querySelector<HTMLButtonElement>(".delete-btn")?.addEventListener("click", async () => {
      await deleteEntryByDate(entry.date);
      await refreshEntries();
      await renderHistory();
      await renderSummary();
    });

    row.querySelector<HTMLButtonElement>(".edit-btn")?.addEventListener("click", () => {
      const formDate = document.getElementById("workDate") as HTMLInputElement;
      const formType = document.getElementById("dayType") as HTMLSelectElement;
      const formStart = document.getElementById("startTime") as HTMLInputElement;
      const formEnd = document.getElementById("endTime") as HTMLInputElement;
      const formPause = document.getElementById("pauseTime") as HTMLInputElement;

      formDate.value = entry.date;
      formType.value = entry.type;

      if (entry.type === "normal") {
        formStart.value = "";
        formEnd.value = "";
        formPause.value = "0";
        timeInputs.style.display = "block";
      } else {
        timeInputs.style.display = "none";
      }

      infoMessage.textContent = "Editing entry...";
      formDate.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

// ----------- Summary Rendering (uses entriesCache) -----------
async function renderSummary(): Promise<void> {
  if (!yearPicker.value) yearPicker.value = String(new Date().getFullYear());
  if (!monthOnly.value) monthOnly.value = (new Date().getMonth() + 1).toString().padStart(2, "0");

  const monthKey = `${yearPicker.value}-${monthOnly.value}`;
  const yearKey = yearPicker.value;

  const monthEntries = entriesCache.filter(e => e.date.slice(0, 7) === monthKey);
  const yearEntries = entriesCache.filter(e => e.date.slice(0, 4) === yearKey);

  const totalWorkedMonth = monthEntries.reduce((s, e) => s + e.workedMinutes, 0);
  const totalNightMonth = monthEntries.reduce((s, e) => s + e.nightMinutes, 0);
  const daysNormal = monthEntries.filter(e => e.type === "normal").length;
  const daysVacation = monthEntries.filter(e => e.type === "vacation").length;
  const daysSick = monthEntries.filter(e => e.type === "sick").length;

  sumWorked.textContent = formatTime(totalWorkedMonth);
  sumNight.textContent = formatTime(totalNightMonth);
  sumDaysNormal.textContent = String(daysNormal);
  sumDaysVacation.textContent = String(daysVacation);
  sumDaysSick.textContent = String(daysSick);

  const allowance = loadAllowance();
  vacAllowanceInput.value = String(allowance);

  const vacUsedThisYear = yearEntries.filter(e => e.type === "vacation").length;
  const remaining = Math.max(0, allowance - vacUsedThisYear);

  sumVacUsed.textContent = String(vacUsedThisYear);
  sumVacRemaining.textContent = String(remaining);

  renderCalendar();
}

// ----------- Date utilities & quick controls -----------
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(dateStr: string): Date {
  const parts = dateStr.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) throw new Error("Invalid date format");
  return new Date(y, m - 1, d);
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const dt = dateStr ? parseISO(dateStr) : new Date();
  dt.setDate(dt.getDate() + deltaDays);
  return fmtDate(dt);
}

// Default date to today if empty
if (!workDateInput.value) workDateInput.value = fmtDate(new Date());

// Date picker helpers
openCalendarBtn?.addEventListener("click", () => {
  (workDateInput as any).showPicker?.() ?? workDateInput.focus();
});
todayBtn?.addEventListener("click", () => { workDateInput.value = fmtDate(new Date()); });
yesterdayBtn?.addEventListener("click", () => { workDateInput.value = shiftDate(workDateInput.value, -1); });
minusDayBtn?.addEventListener("click", () => { workDateInput.value = shiftDate(workDateInput.value, -1); });
plusDayBtn?.addEventListener("click", () => { workDateInput.value = shiftDate(workDateInput.value, +1); });

// Month nav helpers
function shiftMonth(year: number, month: number, delta: number): { y: number; m: number } {
  let y = year;
  let m = month + delta;
  if (m <= 0) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  return { y, m };
}

prevMonthBtn?.addEventListener("click", async () => {
  const y = parseInt(yearPicker.value) || new Date().getFullYear();
  const m = parseInt(monthOnly.value) || (new Date().getMonth() + 1);
  const next = shiftMonth(y, m, -1);
  yearPicker.value = String(next.y);
  monthOnly.value = next.m.toString().padStart(2, "0");
  await renderSummary();
});

nextMonthBtn?.addEventListener("click", async () => {
  const y = parseInt(yearPicker.value) || new Date().getFullYear();
  const m = parseInt(monthOnly.value) || (new Date().getMonth() + 1);
  const next = shiftMonth(y, m, +1);
  yearPicker.value = String(next.y);
  monthOnly.value = next.m.toString().padStart(2, "0");
  await renderSummary();
});

// Update summary when month/year changes
monthOnly?.addEventListener("change", () => { renderSummary(); });
yearPicker?.addEventListener("change", () => {
  renderSummary();
  if (yearLabel) yearLabel.textContent = yearPicker.value;
});

// ----------- Calendar rendering & drawer -----------
function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}
function firstWeekdayIndexMonFirst(year: number, month1to12: number): number {
  const d = new Date(year, month1to12 - 1, 1).getDay();
  return (d + 6) % 7; // Mon=0..Sun=6
}
function entryMapByDate(): Record<string, Entry> {
  const map: Record<string, Entry> = {};
  for (const e of entriesCache) map[e.date] = e;
  return map;
}

function renderCalendar(): void {
  if (!yearPicker.value) yearPicker.value = String(new Date().getFullYear());
  if (!monthOnly.value) monthOnly.value = String(new Date().getMonth() + 1).padStart(2, "0");
  if (!calendarGrid) return;

  const y = parseInt(yearPicker.value) || new Date().getFullYear();
  const mStr = monthOnly.value || (new Date().getMonth() + 1).toString().padStart(2, "0");
  const m = parseInt(mStr); // 1..12

  const map = entryMapByDate();
  const todayISO = fmtDate(new Date());

  const days = daysInMonth(y, m);
  const leading = firstWeekdayIndexMonFirst(y, m);
  const trailing = (7 - ((leading + days) % 7)) % 7;

  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const prevDays = daysInMonth(prevYear, prevMonth);

  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;

  calendarGrid.innerHTML = "";

  const makeCell = (dateISO: string, inMonth: boolean) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day";
    if (!inMonth) cell.classList.add("outside");

    const dow = new Date(dateISO).getDay();
    if (dow === 0 || dow === 6) cell.classList.add("weekend");
    if (dateISO === todayISO) cell.classList.add("today");

    const num = document.createElement("div");
    num.className = "day-num";
    const dayPart = dateISO.split("-")[2] ?? "1";
    num.textContent = String(parseInt(dayPart, 10));
    cell.appendChild(num);

    const badges = document.createElement("div");
    badges.className = "badges";

    const e = map[dateISO];
    if (e) {
      const type = document.createElement("span");
      type.className = `badge type-${e.type}`;
      type.textContent = e.type === "normal" ? "Normal" : e.type === "vacation" ? "Vacation" : "Sick";
      badges.appendChild(type);

      if (e.type === "normal") {
        const w = document.createElement("span");
        w.className = "badge time";
        w.textContent = formatTime(e.workedMinutes);
        badges.appendChild(w);

        if (e.nightMinutes > 0) {
          const n = document.createElement("span");
          n.className = "badge time";
          n.textContent = `🌙 ${formatTime(e.nightMinutes)}`;
          badges.appendChild(n);
        }
      }
    } else {
      const add = document.createElement("span");
      add.className = "badge";
      add.textContent = "+ Add";
      badges.appendChild(add);
    }

    cell.appendChild(badges);
    cell.addEventListener("click", () => openDayDrawer(dateISO, e ?? null));
    return cell;
  };

  // Leading
  for (let i = leading - 1; i >= 0; i--) {
    const day = prevDays - i;
    const dateISO = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    calendarGrid.appendChild(makeCell(dateISO, false));
  }
  // Current month
  for (let d = 1; d <= days; d++) {
    const dateISO = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarGrid.appendChild(makeCell(dateISO, true));
  }
  // Trailing
  for (let d = 1; d <= trailing; d++) {
    const dateISO = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarGrid.appendChild(makeCell(dateISO, false));
  }
}

// Drawer logic
let drawerSelectedDate: string | null = null;

function openDayDrawer(dateISO: string, entry: Entry | null) {
  if (!dayDrawer || !drawerDate || !drawerBody || !drawerEdit || !drawerDelete) return;

  drawerSelectedDate = dateISO;
  drawerDate.textContent = dateISO;

  if (entry) {
    const typeLabel = entry.type === "normal" ? "Normal" : entry.type === "vacation" ? "Vacation" : "Sick Leave";
    const rows = [
      `<p><strong>Type:</strong> ${typeLabel}</p>`,
      `<p><strong>Worked:</strong> ${formatTime(entry.workedMinutes)}</p>`,
      `<p><strong>Night bonus:</strong> ${formatTime(entry.nightMinutes)}</p>`
    ].join("");
    drawerBody.innerHTML = rows;
    drawerDelete.style.display = "";
    drawerEdit.textContent = "Edit";
  } else {
    drawerBody.innerHTML = `<p>No entry. Click <strong>Add</strong> to create one.</p>`;
    drawerDelete.style.display = "none";
    drawerEdit.textContent = "Add";
  }

  dayDrawer.setAttribute("aria-hidden", "false");
}

function closeDayDrawer() {
  if (!dayDrawer) return;
  dayDrawer.setAttribute("aria-hidden", "true");
  drawerSelectedDate = null;
}

// Drawer events
drawerClose?.addEventListener("click", closeDayDrawer);
dayDrawer?.addEventListener("click", (e) => {
  if (e.target === dayDrawer) closeDayDrawer();
});

// Drawer actions
drawerEdit?.addEventListener("click", () => {
  if (!drawerSelectedDate) return;
  (document.getElementById("workDate") as HTMLInputElement).value = drawerSelectedDate;
  const entry = entriesCache.find(e => e.date === drawerSelectedDate) ?? null;
  (document.getElementById("dayType") as HTMLSelectElement).value = entry?.type ?? "normal";
  timeInputs.style.display = (entry?.type ?? "normal") === "normal" ? "block" : "none";
  closeDayDrawer();
  document.getElementById("workForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

drawerDelete?.addEventListener("click", async () => {
  if (!drawerSelectedDate) return;
  await deleteEntryByDate(drawerSelectedDate);
  closeDayDrawer();
  await refreshEntries();
  await renderHistory();
  await renderSummary();
});

// ----------- Year dropdown grid (optional) -----------
let baseYear = Math.floor((parseInt(yearPicker.value) || new Date().getFullYear()) / 10) * 10;

function renderYearGrid() {
  if (!yearGrid || !yearRangeLabel) return;
  const selectedYear = parseInt(yearPicker.value) || new Date().getFullYear();
  yearGrid.innerHTML = "";
  yearRangeLabel.textContent = `${baseYear}–${baseYear + 15}`;

  for (let y = baseYear; y < baseYear + 16; y++) {
    const btn = document.createElement("button");
    btn.className = "year-cell";
    btn.type = "button";
    btn.textContent = String(y);
    if (y === selectedYear) btn.classList.add("active");
    btn.addEventListener("click", async () => {
      yearPicker.value = String(y);
      if (yearLabel) yearLabel.textContent = String(y);
      await renderSummary();
      closeYearDropdown();
    });
    yearGrid.appendChild(btn);
  }
}

function openYearDropdown() {
  if (!yearDropdownBtn || !yearDropdown) return;
  yearDropdown.hidden = false;
  yearDropdownBtn.setAttribute("aria-expanded", "true");
  renderYearGrid();
}
function closeYearDropdown() {
  if (!yearDropdownBtn || !yearDropdown) return;
  yearDropdown.hidden = true;
  yearDropdownBtn.setAttribute("aria-expanded", "false");
}
yearDropdownBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (yearDropdown?.hidden) openYearDropdown(); else closeYearDropdown();
});
prevDecadeBtn?.addEventListener("click", (e) => { e.stopPropagation(); baseYear -= 16; renderYearGrid(); });
nextDecadeBtn?.addEventListener("click", (e) => { e.stopPropagation(); baseYear += 16; renderYearGrid(); });
document.addEventListener("click", (e) => {
  if (!yearDropdown || !yearDropdownBtn) return;
  if (!yearDropdown.hidden) {
    const target = e.target as Node;
    if (!yearDropdown.contains(target) && target !== yearDropdownBtn) closeYearDropdown();
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeYearDropdown(); });

// ----------- UI Events -----------
dayType.addEventListener("change", () => {
  timeInputs.style.display = dayType.value === "normal" ? "block" : "none";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const type = (document.getElementById("dayType") as HTMLSelectElement).value as Entry["type"];
  const date = (document.getElementById("workDate") as HTMLInputElement).value;

  if (!date) return alert("Please choose a date.");

  if (type !== "normal") {
    const entry: Entry = { date, type, workedMinutes: 480, nightMinutes: 0 };
    await upsertEntry(entry);
    await refreshEntries();
    await renderHistory();
    await renderSummary();
    workedTime.textContent = "08:00";
    nightTime.textContent = "00:00";
    infoMessage.textContent = type === "vacation" ? "Vacation day recorded." : "Sick leave recorded.";
    return;
  }

  const startStr = (document.getElementById("startTime") as HTMLInputElement).value;
  const endStr = (document.getElementById("endTime") as HTMLInputElement).value;
  const pauseMin = parseInt((document.getElementById("pauseTime") as HTMLInputElement).value) || 0;

  if (!startStr || !endStr) return alert("Please fill in both start and end time.");

  const startMin = parseTime(startStr);
  const endMin = parseTime(endStr);

  let totalWorkMin = endMin - startMin - pauseMin;
  if (totalWorkMin < 0) totalWorkMin += 1440;

  const nightMin = calcNightMinutes(startMin, endMin, pauseMin);

  const entry: Entry = { date, type, workedMinutes: totalWorkMin, nightMinutes: nightMin };
  await upsertEntry(entry);
  await refreshEntries();
  await renderHistory();
  await renderSummary();

  workedTime.textContent = formatTime(totalWorkMin);
  nightTime.textContent = formatTime(nightMin);
  infoMessage.textContent = "Normal work day calculated.";
});

saveAllowanceBtn?.addEventListener("click", async () => {
  const n = parseInt(vacAllowanceInput.value);
  if (!Number.isFinite(n) || n < 0) return alert("Please enter a valid non-negative number.");
  saveAllowance(n);
  await renderSummary();
});

// ----------- Auth UI wiring -----------
function showLogin(show: boolean) {
  const appSection = document.getElementById("tracker") as HTMLElement | null;
  if (loginCard) loginCard.style.display = show ? "block" : "none";
  if (appSection) appSection.style.display = show ? "none" : "block";
}

function wireLoginUI() {
  const emailEl = document.getElementById("loginEmail") as HTMLInputElement | null;
  const passEl  = document.getElementById("loginPassword") as HTMLInputElement | null;
  const signup  = document.getElementById("signupBtn") as HTMLButtonElement | null;
  const login   = document.getElementById("loginBtn") as HTMLButtonElement | null;
  const magic   = document.getElementById("magicBtn") as HTMLButtonElement | null;
  const forgot  = document.getElementById("forgotBtn") as HTMLButtonElement | null;

  if (signup) signup.onclick = async () => {
    try {
      const email = (emailEl?.value ?? "").trim();
      const pass  = (passEl?.value ?? "").trim();
      if (!email || !pass) return alert("Enter email and password");
      await signUpWithPassword(email, pass);
      alert("Account created. Check your email if confirmation is required.");
    } catch (e: any) { alert(e.message ?? "Sign up failed"); }
  };

  if (login) login.onclick = async () => {
    try {
      const email = (emailEl?.value ?? "").trim();
      const pass  = (passEl?.value ?? "").trim();
      if (!email || !pass) return alert("Enter email and password");
      await signInWithPassword(email, pass);
      // onAuthStateChange will switch the UI
    } catch (e: any) { alert(e.message ?? "Sign in failed"); }
  };

  if (magic) magic.onclick = async () => {
    try {
      const email = (emailEl?.value ?? "").trim();
      if (!email) return alert("Enter your email");
      await signInWithEmail(email);
      alert("Magic link sent. Check your email.");
    } catch (e: any) { alert(e.message ?? "Magic link failed"); }
  };

  if (forgot) forgot.onclick = async () => {
    try {
      const email = (emailEl?.value ?? "").trim();
      if (!email) return alert("Enter your email");
      await sendPasswordReset(email);
      alert("Password reset link sent. Check your email.");
    } catch (e: any) { alert(e.message ?? "Reset link failed"); }
  };

  const signOutBtn = document.getElementById("signOutBtn") as HTMLButtonElement | null;
  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      await (window as any).supabase.auth.signOut();
    };
  }
}

// ----------- Initial Setup -----------
async function init() {
  wireLoginUI();

  // Handle password recovery link
  const hash = location.hash || "";
  if (hash.includes("type=recovery")) {
    const newPass = prompt("Set a new password:");
    if (newPass && newPass.length >= 6) {
      try {
        await finishPasswordReset(newPass);
        alert("Password updated. You are signed in.");
      } catch (e: any) {
        alert(e.message ?? "Password update failed");
      }
    }
  }

  const user = await getCurrentUser();
  if (!user) {
    showLogin(true);
    return;
  }

  currentUserId = user.id;
  showLogin(false);

  setMonthYearToToday();
  await refreshEntries();
  await renderHistory();
  await renderSummary();

  onAuthStateChanged(async (u) => {
    if (!u) {
      currentUserId = null;
      entriesCache = [];
      showLogin(true);
    } else {
      currentUserId = u.id;
      showLogin(false);
      await refreshEntries();
      await renderHistory();
      await renderSummary();
    }
  });
}

init();
