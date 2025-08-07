// Get DOM elements
const taskInput = document.getElementById('taskInput');
const addTaskButton = document.getElementById('addTaskButton');
const taskList = document.getElementById('taskList');
// Load tasks from localStorage
let tasks = loadTasks();
function loadTasks() {
    const data = localStorage.getItem('tasks');
    return data ? JSON.parse(data) : [];
}
function saveTasks() {
    localStorage.setItem('tasks', JSON.stringify(tasks));
}
// Add new task
function addNewTask() {
    const text = taskInput.value.trim();
    if (text === '')
        return;
    const newTask = {
        id: Date.now(),
        text: text,
        done: false,
    };
    tasks.push(newTask);
    taskInput.value = '';
    saveTasks();
    renderTasks();
}
function renderTasks() {
    taskList.innerHTML = '';
    tasks.forEach((task) => {
        const li = document.createElement('li');
        // Task text
        const span = document.createElement('span');
        span.textContent = task.text;
        if (task.done) {
            span.style.textDecoration = 'line-through';
            span.style.color = '#888';
        }
        // Actions container
        const actions = document.createElement('div');
        actions.className = 'actions';
        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.done;
        checkbox.onchange = () => {
            task.done = checkbox.checked;
            saveTasks();
            renderTasks();
        };
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '❌';
        deleteBtn.onclick = () => {
            tasks = tasks.filter(t => t.id !== task.id);
            saveTasks();
            renderTasks();
        };
        actions.appendChild(checkbox);
        actions.appendChild(deleteBtn);
        // Assemble
        li.appendChild(span);
        li.appendChild(actions);
        taskList.appendChild(li);
    });
}
// Events
addTaskButton.addEventListener('click', () => {
    addNewTask();
});
taskInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        addNewTask();
    }
});
// Initial render
renderTasks();
export {};
//# sourceMappingURL=main.js.map