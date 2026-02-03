/**
 * To-Do Module - Task management for users
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

let pool = null;
let usePostgres = false;

async function initTodoModule(dbPool, isPostgres) {
  pool = dbPool;
  usePostgres = isPostgres;

  if (usePostgres && pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          text TEXT NOT NULL,
          completed BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id)');
      console.log('Todo table initialized');
    } catch (err) {
      console.error('Todo table creation error:', err.message);
    }
  }
}

async function getTodos(userId) {
  if (usePostgres && pool) {
    const result = await pool.query(
      'SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      completed: row.completed,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }));
  } else {
    const filePath = path.join(DATA_DIR, 'todos.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const todos = JSON.parse(data);
      return (todos[userId] || []);
    } catch {
      return [];
    }
  }
}

async function addTodo(userId, text) {
  const todo = {
    id: uuidv4(),
    text,
    completed: false,
    createdAt: new Date().toISOString()
  };

  if (usePostgres && pool) {
    await pool.query(
      'INSERT INTO todos (id, user_id, text, completed) VALUES ($1, $2, $3, $4)',
      [todo.id, userId, text, false]
    );
  } else {
    const filePath = path.join(DATA_DIR, 'todos.json');
    let todos = {};
    try {
      const data = await fs.readFile(filePath, 'utf8');
      todos = JSON.parse(data);
    } catch {}

    if (!todos[userId]) todos[userId] = [];
    todos[userId].unshift(todo);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(todos, null, 2));
  }

  return todo;
}

async function updateTodo(userId, todoId, updates) {
  if (usePostgres && pool) {
    const setClauses = [];
    const values = [];
    let idx = 1;

    if (updates.text !== undefined) {
      setClauses.push(`text = $${idx++}`);
      values.push(updates.text);
    }
    if (updates.completed !== undefined) {
      setClauses.push(`completed = $${idx++}`);
      values.push(updates.completed);
      if (updates.completed) {
        setClauses.push(`completed_at = $${idx++}`);
        values.push(new Date().toISOString());
      }
    }

    if (setClauses.length > 0) {
      values.push(todoId, userId);
      await pool.query(
        `UPDATE todos SET ${setClauses.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`,
        values
      );
    }
  } else {
    const filePath = path.join(DATA_DIR, 'todos.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const todos = JSON.parse(data);

      if (todos[userId]) {
        const idx = todos[userId].findIndex(t => t.id === todoId);
        if (idx !== -1) {
          todos[userId][idx] = { ...todos[userId][idx], ...updates };
          if (updates.completed) {
            todos[userId][idx].completedAt = new Date().toISOString();
          }
          await fs.writeFile(filePath, JSON.stringify(todos, null, 2));
        }
      }
    } catch {}
  }
}

async function deleteTodo(userId, todoId) {
  if (usePostgres && pool) {
    await pool.query('DELETE FROM todos WHERE id = $1 AND user_id = $2', [todoId, userId]);
  } else {
    const filePath = path.join(DATA_DIR, 'todos.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const todos = JSON.parse(data);

      if (todos[userId]) {
        todos[userId] = todos[userId].filter(t => t.id !== todoId);
        await fs.writeFile(filePath, JSON.stringify(todos, null, 2));
      }
    } catch {}
  }
}

async function getActiveTodos(userId, limit = 5) {
  const todos = await getTodos(userId);
  return todos.filter(t => !t.completed).slice(0, limit);
}

module.exports = {
  initTodoModule,
  getTodos,
  addTodo,
  updateTodo,
  deleteTodo,
  getActiveTodos
};
