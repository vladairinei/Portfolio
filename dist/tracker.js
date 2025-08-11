// ==============================
// Tracker (TypeScript) – Supabase auth + per‑user storage
// ==============================
// ----------- Helpers -----------
function parseTime(str) {
    const parts = str.split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
        throw new Error("Invalid time format");
    }
    return h * 60 + m;
}
function formatTime(minutes) {
    const h = Math.floor(minutes / 60).toString().padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
}
// Night bonus minutes: 20:00–06:00, subtracting pause (placed mid-shift)
function calcNightMinutes(start, end, pauseMin) {
    if (end < start)
        end += 1440; // overnight shift
    const totalWorked = end - start;
    if (totalWorked <= 0)
        return 0;
    const pauseStart = start + Math.floor(totalWorked / 2) - Math.floor(pauseMin / 2);
    const pauseEnd = pauseStart + pauseMin;
    let nightMinutes = 0;
    for (let t = start; t < end; t++) {
        if (t >= pauseStart && t < pauseEnd)
            continue;
        const minuteOfDay = t % 1440;
        if (minuteOfDay < 360 || minuteOfDay >= 1200)
            nightMinutes++;
    }
    return nightMinutes;
}
// ----------- Auth helpers (Supabase is injected via HTML) -----------
async function getCurrentUser() {
    const { data } = await window.supabase.auth.getUser();
    return data.user ? { id: data.user.id } : null;
}
async function signInWithEmail(email) {
    const { error } = await window.supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.href }
    });
    if (error)
        throw error;
}
function onAuthStateChanged(handler) {
    const supabase = window.supabase;
    supabase.auth.onAuthStateChange(async () => {
        handler(await getCurrentUser());
    });
}
// ----------- Cloud storage (Supabase) -----------
let currentUserId = null;
let entriesCache = [];
async function refreshEntries() {
    if (!currentUserId) {
        entriesCache = [];
        return;
    }
    const { data, error } = await window.supabase
        .from("entries")
        .select("*")
        .eq("user_id", currentUserId)
        .order("date", { ascending: true });
    if (error) {
        console.error(error);
        entriesCache = [];
        return;
    }
    entriesCache = data.map(r => ({
        date: r.date,
        type: r.type,
        workedMinutes: r.worked_minutes,
        nightMinutes: r.night_minutes
    }));
}
async function upsertEntry(entry) {
    if (!currentUserId)
        return;
    const { error } = await window.supabase.from("entries").upsert({
        user_id: currentUserId,
        date: entry.date,
        type: entry.type,
        worked_minutes: entry.workedMinutes,
        night_minutes: entry.nightMinutes
    });
    if (error)
        throw error;
}
async function deleteEntryByDate(dateISO) {
    if (!currentUserId)
        return;
    const { error } = await window.supabase
        .from("entries")
        .delete()
        .eq("user_id", currentUserId)
        .eq("date", dateISO);
    if (error)
        throw error;
}
// Vacation allowance per year (still local for now; easy to move to DB later)
function loadAllowance() {
    const raw = localStorage.getItem("vacAllowance");
    const n = raw ? parseInt(raw) : 30;
    return Number.isFinite(n) ? n : 30;
}
function saveAllowance(n) {
    localStorage.setItem("vacAllowance", String(n));
}
// ----------- DOM Setup -----------
const form = document.getElementById("workForm");
const dayType = document.getElementById("dayType");
const timeInputs = document.getElementById("timeInputs");
const workedTime = document.getElementById("workedTime");
const nightTime = document.getElementById("nightTime");
const infoMessage = document.getElementById("infoMessage");
// History table (may not exist if you switched to calendar view)
const historyTable = document.querySelector("#historyTable tbody");
// Summary DOM (separate month + year)
const monthOnly = document.getElementById("monthOnly");
const yearPicker = document.getElementById("yearPicker");
const vacAllowanceInput = document.getElementById("vacAllowance");
const saveAllowanceBtn = document.getElementById("saveAllowanceBtn");
const sumWorked = document.getElementById("sumWorked");
const sumNight = document.getElementById("sumNight");
const sumDaysNormal = document.getElementById("sumDaysNormal");
const sumDaysVacation = document.getElementById("sumDaysVacation");
const sumDaysSick = document.getElementById("sumDaysSick");
const sumVacUsed = document.getElementById("sumVacUsed");
const sumVacRemaining = document.getElementById("sumVacRemaining");
// Auth/UI bits
const loginCard = document.getElementById("loginCard");
const loginBtn = document.getElementById("loginBtn");
const loginEmail = document.getElementById("loginEmail");
const signOutBtn = document.getElementById("signOutBtn");
// Date quick controls
const workDateInput = document.getElementById("workDate");
const openCalendarBtn = document.getElementById("openCalendarBtn");
const todayBtn = document.getElementById("todayBtn");
const yesterdayBtn = document.getElementById("yesterdayBtn");
const minusDayBtn = document.getElementById("minusDayBtn");
const plusDayBtn = document.getElementById("plusDayBtn");
// Month nav
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");
// Calendar & drawer
const calendarGrid = document.getElementById("calendarGrid");
const dayDrawer = document.getElementById("dayDrawer");
const drawerClose = document.getElementById("drawerClose");
const drawerDate = document.getElementById("drawerDate");
const drawerBody = document.getElementById("drawerBody");
const drawerEdit = document.getElementById("drawerEdit");
const drawerDelete = document.getElementById("drawerDelete");
// Year dropdown grid (optional; works if present in HTML)
const yearDropdownBtn = document.getElementById("yearDropdownBtn");
const yearDropdown = document.getElementById("yearDropdown");
const yearLabel = document.getElementById("yearLabel");
const yearRangeLabel = document.getElementById("yearRangeLabel");
const yearGrid = document.getElementById("yearGrid");
const prevDecadeBtn = document.getElementById("prevDecadeBtn");
const nextDecadeBtn = document.getElementById("nextDecadeBtn");
// ---- Force startup to current month/year ----
function setMonthYearToToday() {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, "0");
    yearPicker.value = y;
    const idx = Array.from(monthOnly.options).findIndex(o => o.value === m);
    if (idx >= 0)
        monthOnly.selectedIndex = idx;
    monthOnly.value = m;
    if (yearLabel)
        yearLabel.textContent = y;
}
if (yearLabel)
    yearLabel.textContent = yearPicker.value;
// ----------- History Rendering (uses entriesCache) -----------
async function renderHistory() {
    if (!historyTable)
        return;
    const entries = [...entriesCache].sort((a, b) => b.date.localeCompare(a.date));
    historyTable.innerHTML = "";
    for (const entry of entries) {
        const row = document.createElement("tr");
        const typeLabel = entry.type === "normal" ? "Normal" :
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
        // Delete
        row.querySelector(".delete-btn")?.addEventListener("click", async () => {
            await deleteEntryByDate(entry.date);
            await refreshEntries();
            await renderHistory();
            await renderSummary();
        });
        // Edit (prefill form)
        row.querySelector(".edit-btn")?.addEventListener("click", () => {
            const formDate = document.getElementById("workDate");
            const formType = document.getElementById("dayType");
            const formStart = document.getElementById("startTime");
            const formEnd = document.getElementById("endTime");
            const formPause = document.getElementById("pauseTime");
            formDate.value = entry.date;
            formType.value = entry.type;
            if (entry.type === "normal") {
                formStart.value = "";
                formEnd.value = "";
                formPause.value = "0";
                timeInputs.style.display = "block";
            }
            else {
                timeInputs.style.display = "none";
            }
            infoMessage.textContent = "Editing entry...";
            formDate.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    }
}
// ----------- Summary Rendering (uses entriesCache) -----------
async function renderSummary() {
    // Fallbacks if somehow empty (won't override our forced init)
    if (!yearPicker.value)
        yearPicker.value = String(new Date().getFullYear());
    if (!monthOnly.value)
        monthOnly.value = (new Date().getMonth() + 1).toString().padStart(2, "0");
    const monthKey = `${yearPicker.value}-${monthOnly.value}`; // YYYY-MM
    const yearKey = yearPicker.value; // YYYY
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
function fmtDate(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function parseISO(dateStr) {
    const parts = dateStr.split("-");
    const y = Number(parts[0]);
    const m = Number(parts[1]); // 1–12
    const d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
        throw new Error("Invalid date format");
    }
    return new Date(y, m - 1, d);
}
function shiftDate(dateStr, deltaDays) {
    const dt = dateStr ? parseISO(dateStr) : new Date();
    dt.setDate(dt.getDate() + deltaDays);
    return fmtDate(dt);
}
// Default date to today if empty
if (!workDateInput.value)
    workDateInput.value = fmtDate(new Date());
// Open native date picker (Chromium), or focus fallback
openCalendarBtn?.addEventListener("click", () => {
    workDateInput.showPicker?.() ?? workDateInput.focus();
});
todayBtn?.addEventListener("click", () => {
    workDateInput.value = fmtDate(new Date());
});
yesterdayBtn?.addEventListener("click", () => {
    workDateInput.value = shiftDate(workDateInput.value, -1);
});
minusDayBtn?.addEventListener("click", () => {
    workDateInput.value = shiftDate(workDateInput.value, -1);
});
plusDayBtn?.addEventListener("click", () => {
    workDateInput.value = shiftDate(workDateInput.value, +1);
});
// Month nav helpers
function shiftMonth(year, month, delta) {
    let y = year;
    let m = month + delta;
    if (m <= 0) {
        m = 12;
        y--;
    }
    if (m > 12) {
        m = 1;
        y++;
    }
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
    if (yearLabel)
        yearLabel.textContent = yearPicker.value;
});
// ----------- Calendar rendering & drawer -----------
function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate(); // month is 1–12 here
}
function firstWeekdayIndexMonFirst(year, month1to12) {
    const d = new Date(year, month1to12 - 1, 1).getDay();
    return (d + 6) % 7;
}
function entryMapByDate() {
    const map = {};
    for (const e of entriesCache)
        map[e.date] = e;
    return map;
}
function renderCalendar() {
    if (!yearPicker.value)
        yearPicker.value = String(new Date().getFullYear());
    if (!monthOnly.value)
        monthOnly.value = String(new Date().getMonth() + 1).padStart(2, "0");
    if (!calendarGrid)
        return;
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
    // Helper to build a day cell
    const makeCell = (dateISO, inMonth) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cal-day";
        if (!inMonth)
            cell.classList.add("outside");
        const dow = new Date(dateISO).getDay(); // 0=Sun..6=Sat
        if (dow === 0 || dow === 6)
            cell.classList.add("weekend");
        if (dateISO === todayISO)
            cell.classList.add("today");
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
            type.textContent =
                e.type === "normal" ? "Normal" :
                    e.type === "vacation" ? "Vacation" : "Sick";
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
        }
        else {
            const add = document.createElement("span");
            add.className = "badge";
            add.textContent = "+ Add";
            badges.appendChild(add);
        }
        cell.appendChild(badges);
        // click → open drawer
        cell.addEventListener("click", () => openDayDrawer(dateISO, e ?? null));
        return cell;
    };
    // Leading days
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
    // Trailing days
    for (let d = 1; d <= trailing; d++) {
        const dateISO = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        calendarGrid.appendChild(makeCell(dateISO, false));
    }
}
// Drawer logic
let drawerSelectedDate = null;
function openDayDrawer(dateISO, entry) {
    if (!dayDrawer || !drawerDate || !drawerBody || !drawerEdit || !drawerDelete)
        return;
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
    }
    else {
        drawerBody.innerHTML = `<p>No entry. Click <strong>Add</strong> to create one.</p>`;
        drawerDelete.style.display = "none";
        drawerEdit.textContent = "Add";
    }
    dayDrawer.setAttribute("aria-hidden", "false");
}
function closeDayDrawer() {
    if (!dayDrawer)
        return;
    dayDrawer.setAttribute("aria-hidden", "true");
    drawerSelectedDate = null;
}
// Drawer events
drawerClose?.addEventListener("click", closeDayDrawer);
dayDrawer?.addEventListener("click", (e) => {
    if (e.target === dayDrawer)
        closeDayDrawer(); // click backdrop
});
// Drawer actions
drawerEdit?.addEventListener("click", () => {
    if (!drawerSelectedDate)
        return;
    document.getElementById("workDate").value = drawerSelectedDate;
    const entry = entriesCache.find(e => e.date === drawerSelectedDate) ?? null;
    document.getElementById("dayType").value = entry?.type ?? "normal";
    timeInputs.style.display = (entry?.type ?? "normal") === "normal" ? "block" : "none";
    closeDayDrawer();
    document.getElementById("workForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
drawerDelete?.addEventListener("click", async () => {
    if (!drawerSelectedDate)
        return;
    await deleteEntryByDate(drawerSelectedDate);
    closeDayDrawer();
    await refreshEntries();
    await renderHistory();
    await renderSummary();
});
// ----------- Year dropdown grid (optional) -----------
let baseYear = Math.floor((parseInt(yearPicker.value) || new Date().getFullYear()) / 10) * 10;
function renderYearGrid() {
    if (!yearGrid || !yearRangeLabel)
        return;
    const selectedYear = parseInt(yearPicker.value) || new Date().getFullYear();
    yearGrid.innerHTML = "";
    yearRangeLabel.textContent = `${baseYear}–${baseYear + 15}`;
    for (let y = baseYear; y < baseYear + 16; y++) {
        const btn = document.createElement("button");
        btn.className = "year-cell";
        btn.type = "button";
        btn.textContent = String(y);
        if (y === selectedYear)
            btn.classList.add("active");
        btn.addEventListener("click", async () => {
            yearPicker.value = String(y);
            if (yearLabel)
                yearLabel.textContent = String(y);
            await renderSummary();
            closeYearDropdown();
        });
        yearGrid.appendChild(btn);
    }
}
function openYearDropdown() {
    if (!yearDropdownBtn || !yearDropdown)
        return;
    yearDropdown.hidden = false;
    yearDropdownBtn.setAttribute("aria-expanded", "true");
    renderYearGrid();
}
function closeYearDropdown() {
    if (!yearDropdownBtn || !yearDropdown)
        return;
    yearDropdown.hidden = true;
    yearDropdownBtn.setAttribute("aria-expanded", "false");
}
yearDropdownBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (yearDropdown?.hidden)
        openYearDropdown();
    else
        closeYearDropdown();
});
prevDecadeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    baseYear -= 16;
    renderYearGrid();
});
nextDecadeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    baseYear += 16;
    renderYearGrid();
});
document.addEventListener("click", (e) => {
    if (!yearDropdown || !yearDropdownBtn)
        return;
    if (!yearDropdown.hidden) {
        const target = e.target;
        if (!yearDropdown.contains(target) && target !== yearDropdownBtn) {
            closeYearDropdown();
        }
    }
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
        closeYearDropdown();
});
// ----------- UI Events -----------
dayType.addEventListener("change", () => {
    timeInputs.style.display = dayType.value === "normal" ? "block" : "none";
});
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = document.getElementById("dayType").value;
    const date = document.getElementById("workDate").value;
    if (!date) {
        alert("Please choose a date.");
        return;
    }
    if (type !== "normal") {
        const entry = { date, type, workedMinutes: 480, nightMinutes: 0 };
        await upsertEntry(entry);
        await refreshEntries();
        await renderHistory();
        await renderSummary();
        workedTime.textContent = "08:00";
        nightTime.textContent = "00:00";
        infoMessage.textContent = type === "vacation" ? "Vacation day recorded." : "Sick leave recorded.";
        return;
    }
    const startStr = document.getElementById("startTime").value;
    const endStr = document.getElementById("endTime").value;
    const pauseMin = parseInt(document.getElementById("pauseTime").value) || 0;
    if (!startStr || !endStr) {
        alert("Please fill in both start and end time.");
        return;
    }
    const startMin = parseTime(startStr);
    const endMin = parseTime(endStr);
    let totalWorkMin = endMin - startMin - pauseMin;
    if (totalWorkMin < 0)
        totalWorkMin += 1440;
    const nightMin = calcNightMinutes(startMin, endMin, pauseMin);
    const entry = {
        date,
        type,
        workedMinutes: totalWorkMin,
        nightMinutes: nightMin
    };
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
    if (!Number.isFinite(n) || n < 0) {
        alert("Please enter a valid non-negative number.");
        return;
    }
    saveAllowance(n);
    await renderSummary();
});
// ----------- Auth UI wiring -----------
function showLogin(show) {
    const appSection = document.getElementById("tracker");
    if (loginCard)
        loginCard.style.display = show ? "block" : "none";
    if (appSection)
        appSection.style.display = show ? "none" : "block";
}
function wireLoginUI() {
    if (loginBtn && loginEmail) {
        loginBtn.onclick = async () => {
            const email = loginEmail.value.trim();
            if (!email) {
                alert("Enter your email");
                return;
            }
            try {
                await signInWithEmail(email);
                alert("Magic link sent. Check your email.");
            }
            catch (e) {
                alert(e?.message ?? "Sign-in failed");
            }
        };
    }
    if (signOutBtn) {
        signOutBtn.onclick = async () => {
            await window.supabase.auth.signOut();
        };
    }
}
// ----------- Initial Setup -----------
async function init() {
    wireLoginUI();
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
        }
        else {
            currentUserId = u.id;
            showLogin(false);
            await refreshEntries();
            await renderHistory();
            await renderSummary();
        }
    });
}
init();
export {};
//# sourceMappingURL=tracker.js.map