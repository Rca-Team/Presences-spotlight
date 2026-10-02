import { createNextServerHelpers } from '@appwrite.io/react/server/next';
import { Providers } from './providers';

const appwrite = {
    endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const helpers = createNextServerHelpers(appwrite);
    const session = await helpers.readSessionCookie();

    return (
        <html lang="en">
            <body>
                <Providers session={session}>{children}</Providers>
            </body>
        </html>
    );
}
