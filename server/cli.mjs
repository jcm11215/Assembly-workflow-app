/**
 * Admin tasks from the server's own terminal. The installed
 * `assembly-workflow` command (deploy/assembly-workflow) runs these as
 * the right user; directly, they are:
 *
 *   node server/cli.mjs setup-code              the code for creating the first admin in the browser
 *   node server/cli.mjs create-admin            make an admin login (asks for the details)
 *   node server/cli.mjs set-password <login>    set anyone's password
 *   node server/cli.mjs users                   list every login
 *   node server/cli.mjs backup                  write a database backup now
 *   node server/cli.mjs legacy-auth off         stop checking old Supabase passwords
 *   node server/cli.mjs import-localai <folder> bring in the old Local AI's documents and corrections
 *
 * Uses the same DATA_DIR as the server (see config.mjs), and is safe to
 * run while the server is running.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { paths } from './config.mjs';
import fs from 'node:fs';
import { openDb, now, getSetting } from './db.mjs';
import { hashPassword, passwordProblem, normalizeLogin, loginProblem, endAllSessions } from './auth.mjs';
import { insertUser } from './routes/session.mjs';
import { backupNow } from './backup.mjs';
import { importLocalAi } from './import-localai.mjs';

const [command, ...args] = process.argv.slice(2);
const db = openDb(paths.db);

async function ask(question, { hidden = false } = {}){
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  if(hidden){
    // Echo nothing while a password is typed.
    rl._writeToOutput = s => { if(s.includes(question)) stdout.write(s); };
  }
  const answer = await rl.question(question);
  rl.close();
  if(hidden) stdout.write('\n');
  return answer.trim();
}

async function askPassword(){
  for(;;){
    const pw = await ask('Password (8+ characters): ', { hidden: true });
    const problem = passwordProblem(pw);
    if(problem){ console.log(problem); continue; }
    if(pw !== await ask('Same password again: ', { hidden: true })){ console.log('They did not match.'); continue; }
    return pw;
  }
}

const commands = {
  'setup-code'(){
    const { n } = db.get('select count(*) as n from users');
    if(n > 0){ console.log(`Already set up (${n} login${n === 1 ? '' : 's'}). Sign in, or make another admin with create-admin.`); return; }
    let code = '';
    try { code = fs.readFileSync(paths.setupCode, 'utf8').trim(); } catch { /* not started yet */ }
    if(!code) throw new Error('No setup code yet: the app makes one when it starts. Start it, then try again.');
    console.log(`Setup code: ${code}`);
    console.log('Open the app in a browser and create the first admin with it.');
  },

  async 'create-admin'(){
    const fullName = await ask('Name: ');
    const login = normalizeLogin(await ask('Username (or email): '));
    const lp = loginProblem(login);
    if(!fullName || lp) throw new Error(lp || 'A name is required.');
    const password = await askPassword();
    const user = await insertUser(db, { fullName, login, password, role: 'admin' });
    console.log(`Created admin ${user.fullName} -- sign in as ${user.login}.`);
  },

  async 'set-password'(){
    const login = normalizeLogin(args[0] || await ask('Username: '));
    const row = db.get('select id, full_name from users where login = ?', login);
    if(!row) throw new Error(`No login "${login}".`);
    const password = await askPassword();
    db.run('update users set password_hash = ?, updated_at = ? where id = ?', await hashPassword(password), now(), row.id);
    endAllSessions(db, row.id);
    console.log(`New password set for ${row.full_name}; they have been signed out everywhere.`);
  },

  users(){
    const rows = db.all('select login, full_name, role, active, password_hash is not null as has_pw from users order by full_name');
    if(!rows.length){ console.log('No logins yet. Run: assembly-workflow create-admin'); return; }
    for(const r of rows){
      console.log(`${r.login.padEnd(28)} ${r.full_name.padEnd(24)} ${r.role.padEnd(10)} ${r.active ? 'active' : 'switched off'}${r.has_pw ? '' : ' (no password yet)'}`);
    }
  },

  backup(){
    console.log(`Backup written: ${backupNow(db)}`);
  },

  async 'import-localai'(){
    if(!args[0]) throw new Error('Give the folder the Local AI was installed in, e.g. import-localai /home/you/localai');
    fs.mkdirSync(paths.files, { recursive: true });
    await importLocalAi(db, paths.files, args[0]);
  },

  'legacy-auth'(){
    if(args[0] !== 'off'){
      console.log(getSetting(db, 'legacyAuth') ? 'Old Supabase passwords are still accepted on first sign-in.' : 'Old Supabase passwords are not checked.');
      console.log('Turn it off with: node server/cli.mjs legacy-auth off');
      return;
    }
    db.run("delete from settings where key = 'legacyAuth'");
    const waiting = db.get('select count(*) as n from users where password_hash is null').n;
    console.log(`Stopped checking old Supabase passwords.${waiting ? ` ${waiting} login(s) still have no password -- set them with set-password.` : ''}`);
  }
};

try {
  if(!commands[command]){
    console.log('Usage: node server/cli.mjs <setup-code | create-admin | set-password [login] | users | backup | legacy-auth [off] | import-localai <folder>>');
    process.exitCode = command ? 1 : 0;
  } else {
    await commands[command]();
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
