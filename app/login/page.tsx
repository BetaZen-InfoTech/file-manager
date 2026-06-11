import LoginForm from './form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  // Optional "default login" convenience — only shown when BOTH env vars are
  // set. Reading them server-side (not NEXT_PUBLIC) keeps them out of the
  // static bundle; they still reach the browser when enabled, so only enable
  // this for demo/staging, never with a privileged production admin.
  const demoEmail = process.env.DEMO_LOGIN_EMAIL || '';
  const demoPassword = process.env.DEMO_LOGIN_PASSWORD || '';
  return <LoginForm demoEmail={demoEmail} demoPassword={demoPassword} />;
}
