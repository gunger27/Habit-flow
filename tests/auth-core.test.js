'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNewPassword, authErrorMessage, signupResultMessage } = require('../auth-core.js');

test('new passwords need eight characters and at least one digit', () => {
  assert.match(validateNewPassword('short1'), /mindestens 8 Zeichen/);
  assert.match(validateNewPassword('longenough'), /mindestens eine Zahl/);
  assert.equal(validateNewPassword('habitflow1'), '');
});

test('duplicate account errors direct the user to sign in', () => {
  assert.match(authErrorMessage({ code: 'user_already_exists' }, 'signup'), /bereits ein Konto/);
});

test('invalid credentials do not reveal whether an email is registered', () => {
  const message = authErrorMessage({ message: 'Invalid login credentials' }, 'signin');
  assert.match(message, /Prüfe E-Mail und Passwort/);
  assert.doesNotMatch(message, /E-Mail gibt es|nicht registriert/);
});

test('signup confirmation uses a privacy-preserving message when no session is returned', () => {
  const result = signupResultMessage(null);
  assert.equal(result.type, 'success');
  assert.match(result.text, /Wenn diese E-Mail noch nicht registriert ist/);
  assert.match(result.text, /wähle „Anmelden“/);
});

test('signup with immediate session reports successful login', () => {
  assert.match(signupResultMessage({ access_token: 'present' }).text, /Konto erstellt und angemeldet/);
});

