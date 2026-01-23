const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class SimpleStore {
  constructor(options = {}) {
    this.defaults = options.defaults || {};
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileData = fs.readFileSync(this.filePath, 'utf8');
        return { ...this.defaults, ...JSON.parse(fileData) };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
    return { ...this.defaults };
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  get(key, defaultValue) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  has(key) {
    return key in this.data;
  }

  delete(key) {
    delete this.data[key];
    this.save();
  }

  clear() {
    this.data = { ...this.defaults };
    this.save();
  }
}

module.exports = SimpleStore;
