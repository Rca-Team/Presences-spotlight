import { createNextServerHelpers } from '@appwrite.io/react/server/next';
import { AuthPanel } from './auth-panel';

const appwrite = {
    endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
};

export default async function Page() {
    const helpers = createNextServerHelpers(appwrite);
    const user = await helpers.getLoggedInUser();

    return (
        <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
            <h1>Appwrite SSR Auth Panel</h1>
            <p>SSR user: <strong>{user?.email ?? 'signed out'}</strong></p>
            <AuthPanel />
        </main>
    );
}
