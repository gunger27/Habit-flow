(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HabitFlowAuthCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function validateNewPassword(password) {
    if (password.length < 8) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
    if (!/[0-9]/.test(password)) return 'Das Passwort muss mindestens eine Zahl enthalten.';
    return '';
  }

  function authErrorMessage(error, action) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const combined = `${code} ${message}`;
    if (/user_already_exists|already registered|already exists/.test(combined)) return 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Wähle „Anmelden“.';
    if (/invalid login credentials|invalid_credentials/.test(combined)) return 'Anmeldung fehlgeschlagen. Prüfe E-Mail und Passwort. Falls du noch kein Konto hast, wähle „Konto erstellen“.';
    if (/rate limit|too many requests/.test(combined)) return 'Zu viele Versuche. Warte kurz und versuche es dann erneut.';
    if (/invalid email|email.*invalid/.test(message)) return 'Bitte prüfe die eingegebene E-Mail-Adresse.';
    if (/password.*(weak|short|least|characters)/.test(message)) return 'Das Passwort erfüllt die Sicherheitsregeln nicht. Verwende mindestens 8 Zeichen und mindestens eine Zahl.';
    return action === 'signup'
      ? 'Das Konto konnte gerade nicht erstellt werden. Prüfe deine Internetverbindung und versuche es erneut.'
      : 'Die Anmeldung war gerade nicht möglich. Prüfe deine Internetverbindung und deine Zugangsdaten.';
  }

  function signupResultMessage(session) {
    return session
      ? { type: 'success', text: 'Konto erstellt und angemeldet. Deine lokalen Habits werden jetzt synchronisiert.' }
      : { type: 'success', text: 'Wenn diese E-Mail noch nicht registriert ist, wurde ein Bestätigungslink versendet. Prüfe dein Postfach. Falls du bereits ein Konto hast, wähle „Anmelden“.' };
  }

  return { validateNewPassword, authErrorMessage, signupResultMessage };
});

