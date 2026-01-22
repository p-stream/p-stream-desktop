const { app } = require('electron');
console.log('App:', app);
if (app) {
  app.quit();
}
