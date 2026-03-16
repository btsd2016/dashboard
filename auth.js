// ============================================================
// Google OAuth Authentication
// Whitelisted emails only — Ben, Tom, Andy
// ============================================================

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');

// Whitelisted users — only these three accounts can access the dashboard
const ALLOWED_EMAILS = [
  'ben@thesellerdoor.com.au',
  'andy@thesellerdoor.com.au',
  'tom@thesellerdoor.com.au',
];

function setupAuth(app) {
  // Trust Railway's reverse proxy so secure cookies work correctly
  app.set('trust proxy', 1);

  // Session middleware
  app.use(session({
    secret: process.env.SESSION_SECRET || 'tsd-dashboard-session-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days — stay logged in for a week
    }
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // Google OAuth strategy
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'https://dashboard.thesellerdoor.com.au/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    const name = profile.displayName;

    console.log(`[Auth] Login attempt: ${email}`);

    if (!email) {
      return done(null, false, { message: 'No email from Google' });
    }

    // Check whitelist
    if (!ALLOWED_EMAILS.includes(email)) {
      console.log(`[Auth] ❌ Access denied: ${email} (not whitelisted)`);
      return done(null, false, { message: 'Not authorised' });
    }

    console.log(`[Auth] ✅ Access granted: ${email} (${name})`);
    return done(null, { email, name, photo: profile.photos?.[0]?.value });
  }));

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  // ── Auth routes ──────────────────────────────────────────

  // Trigger Google login
  app.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email']
  }));

  // Google callback
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=denied' }),
    (req, res) => {
      console.log(`[Auth] Login success: ${req.user.email}`);
      res.redirect('/');
    }
  );

  // Logout
  app.get('/auth/logout', (req, res) => {
    req.logout(() => res.redirect('/login'));
  });

  // Login page
  app.get('/login', (req, res) => {
    const error = req.query.error;
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>TSD Dashboard — Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1d27;
      border: 1px solid #2a2d3a;
      border-radius: 16px;
      padding: 48px 40px;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }
    .logo {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 3px;
      color: #6b7280;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #f9fafb;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 36px;
    }
    .google-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: #fff;
      color: #1f2937;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      width: 100%;
      transition: background 0.15s;
    }
    .google-btn:hover { background: #f3f4f6; }
    .google-btn svg { flex-shrink: 0; }
    .error {
      background: #3f1f1f;
      border: 1px solid #7f2020;
      color: #fca5a5;
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      margin-bottom: 20px;
    }
    .footer {
      margin-top: 32px;
      font-size: 12px;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">The Seller Door Group</div>
    <h1>Dashboard</h1>
    <p class="subtitle">Sign in to access live venue data</p>
    ${error ? '<div class="error">Access denied — your Google account is not authorised. Contact Ben to be added.</div>' : ''}
    <a href="/auth/google" class="google-btn">
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
      </svg>
      Sign in with Google
    </a>
    <div class="footer">TSD Group — Internal use only</div>
  </div>
</body>
</html>`);
  });
}

// Middleware to protect routes — apply to specific routes only, not globally
function requireLogin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

module.exports = { setupAuth, requireLogin };
