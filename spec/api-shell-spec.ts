import { BrowserWindow, app } from 'electron/main';
import { shell } from 'electron/common';
import { closeAllWindows } from './lib/window-helpers';
import { listen } from './lib/spec-helpers';
import { ifdescribe, ifit } from './lib/spec-conditional';
import * as http from 'http';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { expect } from 'chai';
import { once } from 'events';
import { fixturePath } from './lib/fixtures';

describe('shell module', () => {
  describe('shell.openExternal()', () => {
    let envVars: Record<string, string | undefined> = {};

    beforeEach(function () {
      envVars = {
        display: process.env.DISPLAY,
        de: process.env.DE,
        browser: process.env.BROWSER
      };
    });

    afterEach(async () => {
      // reset env vars to prevent side effects
      if (process.platform === 'linux') {
        process.env.DE = envVars.de;
        process.env.BROWSER = envVars.browser;
        process.env.DISPLAY = envVars.display;
      }
    });
    afterEach(closeAllWindows);

    it('opens an external link', async () => {
      let url = 'http://127.0.0.1';
      let requestReceived: Promise<any>;
      if (process.platform === 'linux') {
        process.env.BROWSER = '/bin/true';
        process.env.DE = 'generic';
        process.env.DISPLAY = '';
        requestReceived = Promise.resolve();
      } else if (process.platform === 'darwin') {
        // On the Mac CI machines, Safari tries to ask for a password to the
        // code signing keychain we set up to test code signing (see
        // https://github.com/electron/electron/pull/19969#issuecomment-526278890),
        // so use a blur event as a crude proxy.
        const w = new BrowserWindow({ show: true });
        requestReceived = once(w, 'blur');
      } else {
        const server = http.createServer((req, res) => {
          res.end();
        });
        url = (await listen(server)).url;
        requestReceived = new Promise<void>(resolve => server.on('connection', () => resolve()));
      }

      await Promise.all<void>([
        shell.openExternal(url),
        requestReceived
      ]);
    });
  });

  describe('shell.trashItem()', () => {
    afterEach(closeAllWindows);

    it('moves an item to the trash', async () => {
      const dir = await fs.mkdtemp(path.resolve(app.getPath('temp'), 'electron-shell-spec-'));
      const filename = path.join(dir, 'temp-to-be-deleted');
      await fs.writeFile(filename, 'dummy-contents');
      await shell.trashItem(filename);
      expect(fs.existsSync(filename)).to.be.false();
    });

    it('throws when called with a nonexistent path', async () => {
      const filename = path.join(app.getPath('temp'), 'does-not-exist');
      await expect(shell.trashItem(filename)).to.eventually.be.rejected();
    });

    ifit(!(process.platform === 'win32' && process.arch === 'ia32'))('works in the renderer process', async () => {
      const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
      w.loadURL('about:blank');
      await expect(w.webContents.executeJavaScript('require(\'electron\').shell.trashItem(\'does-not-exist\')')).to.be.rejectedWith(/does-not-exist|Failed to move item|Failed to create FileOperation/);
    });
  });

  const shortcutOptions = {
    target: 'C:\\target',
    description: 'description',
    cwd: 'cwd',
    args: 'args',
    appUserModelId: 'appUserModelId',
    icon: 'icon',
    iconIndex: 1,
    toastActivatorClsid: '{0E3CFA27-6FEA-410B-824F-A174B6E865E5}'
  };
  ifdescribe(process.platform === 'win32')('shell.readShortcutLink(shortcutPath)', () => {
    it('throws when failed', () => {
      expect(() => {
        shell.readShortcutLink('not-exist');
      }).to.throw('Failed to read shortcut link');
    });

    it('reads all properties of a shortcut', () => {
      const shortcut = shell.readShortcutLink(fixturePath('assets', 'shortcut.lnk'));
      expect(shortcut).to.deep.equal(shortcutOptions);
    });
  });

  ifdescribe(process.platform === 'win32')('shell.writeShortcutLink(shortcutPath[, operation], options)', () => {
    const tmpShortcut = path.join(os.tmpdir(), `${Date.now()}.lnk`);

    afterEach(() => {
      fs.unlinkSync(tmpShortcut);
    });

    it('writes the shortcut', () => {
      expect(shell.writeShortcutLink(tmpShortcut, { target: 'C:\\' })).to.be.true();
      expect(fs.existsSync(tmpShortcut)).to.be.true();
    });

    it('correctly sets the fields', () => {
      expect(shell.writeShortcutLink(tmpShortcut, shortcutOptions)).to.be.true();
      expect(shell.readShortcutLink(tmpShortcut)).to.deep.equal(shortcutOptions);
    });

    it('updates the shortcut', () => {
      expect(shell.writeShortcutLink(tmpShortcut, 'update', shortcutOptions)).to.be.false();
      expect(shell.writeShortcutLink(tmpShortcut, 'create', shortcutOptions)).to.be.true();
      expect(shell.readShortcutLink(tmpShortcut)).to.deep.equal(shortcutOptions);
      const change = { target: 'D:\\' };
      expect(shell.writeShortcutLink(tmpShortcut, 'update', change)).to.be.true();
      expect(shell.readShortcutLink(tmpShortcut)).to.deep.equal({ ...shortcutOptions, ...change });
    });

    it('replaces the shortcut', () => {
      expect(shell.writeShortcutLink(tmpShortcut, 'replace', shortcutOptions)).to.be.false();
      expect(shell.writeShortcutLink(tmpShortcut, 'create', shortcutOptions)).to.be.true();
      expect(shell.readShortcutLink(tmpShortcut)).to.deep.equal(shortcutOptions);
      const change = {
        target: 'D:\\',
        description: 'description2',
        cwd: 'cwd2',
        args: 'args2',
        appUserModelId: 'appUserModelId2',
        icon: 'icon2',
        iconIndex: 2,
        toastActivatorClsid: '{C51A3996-CAD9-4934-848B-16285D4A1496}'
      };
      expect(shell.writeShortcutLink(tmpShortcut, 'replace', change)).to.be.true();
      expect(shell.readShortcutLink(tmpShortcut)).to.deep.equal(change);
    });
  });
});
