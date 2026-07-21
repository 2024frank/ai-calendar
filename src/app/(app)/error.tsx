"use client";

import { useEffect } from "react";
import { Button, Card, Icon } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="error-state">
      <Card>
        <span className="empty-state__icon" aria-hidden="true"><Icon name="alert" /></span>
        <h1>Couldn’t Load This Page</h1>
        <p>The workspace hit an unexpected error. Try again; your saved data is safe.</p>
        <Button variant="primary" icon="refresh" onClick={reset}>Try Again</Button>
      </Card>
    </div>
  );
}
