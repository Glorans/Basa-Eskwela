// Isolated browser fixture; no production credentials or network auth.
const owner = '00000000-0000-4000-8000-000000000002';
export const supabase = { auth: {
  getSession: async () => ({ data: { session: { access_token: 'local-fixture', user: { id: owner } } } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} };
