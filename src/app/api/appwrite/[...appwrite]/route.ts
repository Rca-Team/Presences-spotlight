import { createAppwriteHandlers } from '@appwrite.io/react/handlers/next';

export const { GET, POST } = createAppwriteHandlers({
    endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!,
    apiKey: process.env.APPWRITE_API_KEY!,
    basePath: '/api/appwrite'
});
