// Get DOM elements
const taskInput = document.getElementById('taskInput') as HTMLInputElement;
const addTaskButton = document.getElementById('addTaskButton') as HTMLButtonElement;
const taskList = document.getElementById('taskList') as HTMLUListElement;

// Task type
type Task = {
  id: number;
  text: string;
  done: boolean;
};

// Load tasks from localStorage
let tasks: Task[] = loadTasks();

function loadTasks(): Task[] {
  const data = localStorage.getItem('tasks');
  return data ? JSON.parse(data) : [];
}

function saveTasks(): void {
  localStorage.setItem('tasks', JSON.stringify(tasks));
}

// Add new task
function addNewTask() {
  const text = taskInput.value.trim();
  if (text === '') return;

  const newTask: Task = {
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
  // Clear list
  taskList.innerHTML = '';

  if (tasks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'todo-item';
    empty.style.justifyContent = 'center';
    empty.style.opacity = '0.7';
    empty.textContent = 'No tasks yet — add one above!';
    taskList.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'todo-item';
    li.dataset.id = String(task.id);
    li.setAttribute('role', 'listitem');

    // Task text
    const span = document.createElement('span');
    span.textContent = task.text;
    span.className = 'todo-text';
    if (task.done) {
      span.style.textDecoration = 'line-through';
      span.style.color = '#888';
    }

    // Actions (right side)
    const actions = document.createElement('div');
    actions.className = 'actions';

    // Checkbox (mark done)
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
    checkbox.addEventListener('change', () => {
      task.done = checkbox.checked;
      saveTasks();
      renderTasks();
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Delete task';
    deleteBtn.setAttribute('aria-label', 'Delete task');
    deleteBtn.textContent = '❌';
    deleteBtn.addEventListener('click', () => {
      tasks = tasks.filter(t => t.id !== task.id);
      saveTasks();
      renderTasks();
    });

    // Assemble
    actions.appendChild(checkbox);
    actions.appendChild(deleteBtn);
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