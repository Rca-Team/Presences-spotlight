import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AndroidShareService, SharedMediaPayload } from '@/services/AndroidShareService';

const SharedMediaActionModal = lazy(() => import('./SharedMediaActionModal'));

export const SharedMediaGateway: React.FC = () => {
  const [hasSharedMedia, setHasSharedMedia] = useState(false);

  useEffect(() => {
    const unsub = AndroidShareService.subscribe((payload: SharedMediaPayload) => {
      if (payload?.files?.length > 0) {
        setHasSharedMedia(true);
      }
    });

    return () => {
      unsub();
    };
  }, []);

  if (!hasSharedMedia) return null;

  return (
    <Suspense fallback={null}>
      <SharedMediaActionModal />
    </Suspense>
  );
};

export default SharedMediaGateway;
