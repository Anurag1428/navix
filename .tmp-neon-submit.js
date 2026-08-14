const { spawnSync } = require('child_process');
const cmd = 'C:/Users/DELL/AppData/Roaming/npm/neon.cmd';
const payload = JSON.stringify({
  step: 'setup',
  agent: 'copilot',
  ide: 'vs code',
  mcpConfigured: false,
  skillsScope: 'project',
  mode: 'defaults',
  features: 'database'
});
const result = spawnSync(cmd, ['init', '--agent', '--data', payload], {
  cwd: 'C:/Users/dell/OneDrive/Desktop/navix',
  shell: true,
  encoding: 'utf8'
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 0);