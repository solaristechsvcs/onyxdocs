const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const configPath = path.join(__dirname, '..', 'config.js');
if (!fs.existsSync(configPath)) throw new Error('Copy config.example.js to config.js and configure MySQL, baseUrl, setupKey and sessionSecret.');
const config = require(configPath);
if (!config.sessionSecret || config.sessionSecret.length < 32 || config.sessionSecret.startsWith('REPLACE')) throw new Error('Set a random sessionSecret of at least 32 characters in config.js.');
const pool = mysql.createPool({...config.mysql, multipleStatements: false, charset: 'utf8mb4'});
async function migrate() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, role ENUM('owner','admin','editor') NOT NULL DEFAULT 'editor', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS categories (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, parent_id INT UNSIGNED NULL, name VARCHAR(150) NOT NULL, image_url VARCHAR(2000) NULL, description TEXT, position INT NOT NULL DEFAULT 0, FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT)`,
    `CREATE TABLE IF NOT EXISTS articles (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, category_id INT UNSIGNED NULL, title VARCHAR(200) NOT NULL, slug VARCHAR(200) NOT NULL UNIQUE, summary VARCHAR(500) NOT NULL DEFAULT '', content MEDIUMTEXT NOT NULL, published BOOLEAN NOT NULL DEFAULT FALSE, position INT NOT NULL DEFAULT 0, author_id INT UNSIGNED NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL)`,
    `CREATE TABLE IF NOT EXISTS revisions (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, article_id INT UNSIGNED NOT NULL, title VARCHAR(200) NOT NULL, summary VARCHAR(500) NOT NULL DEFAULT '', content MEDIUMTEXT NOT NULL, author_id INT UNSIGNED NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (sid VARCHAR(128) PRIMARY KEY, data MEDIUMTEXT NOT NULL, expires BIGINT NOT NULL, INDEX (expires))`,
    `CREATE TABLE IF NOT EXISTS settings (setting_key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL)`
  ];
  for (const sql of statements) await pool.query(sql);
}
module.exports = {pool, config, migrate};
