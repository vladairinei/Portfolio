"use strict";
// ----------- Helpers -----------
function parseTime(str) {
    const [h, m] = str.split(":").map(Number);
    if (isNaN(h) || isNaN(m))
        throw new Error("Invalid time format");
    return h * 60 + m;
}
function formatTime(minutes) {
    const h = Math.floor(minutes / 60).toString().padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
}
function calcNightMinutes(start, end, pauseMin) {
    if (end < start)
        end += 1440;
    const workBlock = { start, end };
    const nightBlocks = [
        { start: 0, end: 360 }, // 00:00–06:00
        { start: 1200, end: 1440 } // 20:00–24:00
    ];
    let totalNight = 0;
    for (const night of nightBlocks) {
        for (let shift = 0; shift <= 1440; shift += 1440) {
            const ns = night.start + shift;
            const ne = night.end + shift;
            const overlapStart = Math.max(workBlock.start, ns);
            const overlapEnd = Math.min(workBlock.end, ne);
            if (overlapEnd > overlapStart) {
                totalNight += overlapEnd - overlapStart;
            }
        }
    }
    const totalWorked = workBlock.end - workBlock.start;
    const nightRatio = totalNight / totalWorked;
    const adjusted = totalNight - Math.round(pauseMin * nightRatio);
    return Math.max(0, adjusted);
}
function loadEntries() {
    const data = localStorage.getItem("entries");
    return data ? JSON.parse(data) : [];
}
function saveEntry(entry) {
    const entries = loadEntries();
    const existingIndex = entries.findIndex(e => e.date === entry.date);
    if (existingIndex !== -1) {
        entries[existingIndex] = entry; // overwrite if already exists
    }
    else {
        entries.push(entry);
    }
    localStorage.setItem("entries", JSON.stringify(entries));
}
// ----------- DOM Setup -----------
const form = document.getElementById("workForm");
const dayType = document.getElementById("dayType");
const timeInputs = document.getElementById("timeInputs");
const workedTime = document.getElementById("workedTime");
const nightTime = document.getElementById("nightTime");
const infoMessage = document.getElementById("infoMessage");
const historyTable = document.querySelector("#historyTable tbody");
// ----------- UI Functions -----------
function renderHistory() {
    const entries = loadEntries().sort((a, b) => b.date.localeCompare(a.date));
    historyTable.innerHTML = "";
    for (const entry of entries) {
        const row = document.createElement("tr");
        const typeLabel = {
            normal: "Normal",
            vacation: "Vacation",
            sick: "Sick Leave"
        }[entry.type];
        row.innerHTML = `
      <td>${entry.date}</td>
      <td>${typeLabel}</td>
      <td>${formatTime(entry.workedMinutes)}</td>
      <td>${formatTime(entry.nightMinutes)}</td>
    `;
        historyTable.appendChild(row);
    }
}
dayType.addEventListener("change", () => {
    timeInputs.style.display = dayType.value === "normal" ? "block" : "none";
});
form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = dayType.value;
    const date = document.getElementById("workDate").value;
    if (!date) {
        alert("Please choose a date.");
        return;
    }
    if (type !== "normal") {
        const entry = {
            date,
            type,
            workedMinutes: 480,
            nightMinutes: 0
        };
        saveEntry(entry);
        renderHistory();
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
    saveEntry(entry);
    renderHistory();
    workedTime.textContent = formatTime(totalWorkMin);
    nightTime.textContent = formatTime(nightMin);
    infoMessage.textContent = "Normal work day calculated.";
});
// ----------- Initial Setup -----------
renderHistory();
//# sourceMappingURL=tracker.js.map