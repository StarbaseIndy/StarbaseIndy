'use strict';

const { spawn } = require('child_process');
const slash = require('slash');

const cwd = slash(process.cwd());
const homedir = slash(process.env.USERPROFILE || process.env.HOME);
const [container, ...rest] = process.argv.slice(2);

const mountArgs = [
  `-v ${cwd}:/var/workspace`,
  `-v ${homedir}/.aws:/root/.aws:ro`,
  `-v ${homedir}/.aws:/home/alpine/.aws:ro`,
  '-v /var/run/docker.sock:/var/run/docker.sock',
];

const portArgs = [
  '-p 5900:5900',
  '-p 22:22',
];

const epIndex = rest.indexOf('--entrypoint');
const entrypointArgs = epIndex > -1 ? rest.splice(epIndex, 2) : [];

const envArgs = ['-e', 'AWS_PROFILE'];

const args = ['run', '--rm', '-it', ...envArgs, ...mountArgs, ...portArgs, ...entrypointArgs, container];
// console.log('SPAWN: docker', args);
const shell = spawn('docker', [...args, ...rest], {
  stdio: 'inherit',
  shell: true,
});
// shell.on('close', code => { console.log('[shell] terminated :', code); });