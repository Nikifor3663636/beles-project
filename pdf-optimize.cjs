'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const run = promisify(execFile);
module.exports = async (source, target) => {
  if (process.platform !== 'linux' || process.env.PDF_OPTIMIZE !== 'true')
    return { file: source, optimized: false, reason: 'disabled' };
  const invoke = (command, args) =>
    run('prlimit', ['--as=536870912', '--cpu=30', '--fsize=62914560', '--', command, ...args], {
      timeout: 40000,
      maxBuffer: 65536,
      windowsHide: true,
    });
  try {
    await invoke('qpdf', ['--check', source]);
    const before = (await invoke('qpdf', ['--show-npages', source])).stdout.trim();
    await invoke('gs', [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.7',
      '-dPDFSETTINGS=/printer',
      '-dColorImageResolution=200',
      '-dGrayImageResolution=200',
      '-dMonoImageResolution=300',
      '-dDetectDuplicateImages=true',
      '-dCompressFonts=true',
      '-sOutputFile=' + target,
      '-f',
      source,
    ]);
    await invoke('qpdf', ['--check', target]);
    const after = (await invoke('qpdf', ['--show-npages', target])).stdout.trim();
    if (before !== after || !Number(before)) throw Error('PDF page count mismatch');
    const original = (await fs.stat(source)).size,
      compressed = (await fs.stat(target)).size;
    return {
      file: compressed < original ? target : source,
      optimized: compressed < original,
      pages: Number(before),
    };
  } catch (error) {
    if (/No space left|ENOSPC/.test(String(error.stderr || error.message))) {
      const full = Error('Недостатньо місця для обробки PDF.');
      full.status = 507;
      throw full;
    }
    if (error.code === 'ENOENT' || String(error.stderr || '').includes('No such file'))
      return { file: source, optimized: false, reason: 'tools_unavailable' };
    const failure = Error(
      'PDF не пройшов перевірку або перевищив ліміт обробки. Вихідний файл не змінено.',
    );
    failure.status = 415;
    throw failure;
  }
};
