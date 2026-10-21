const fs = require('node:fs');
const path = require('node:path');

module.exports = function storage(root, directory = process.env.BELES_STORAGE_DIR) {
  const base = directory ? path.resolve(directory) : root;
  const data = path.join(base, 'data');
  const uploads = path.join(base, 'uploads');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(uploads, { recursive: true });
  if (base !== root && !process.env.DATABASE_URL) {
    try {
      fs.copyFileSync(
        path.join(root, 'data/catalog.json'),
        path.join(data, 'catalog.json'),
        fs.constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return { data, uploads };
};
