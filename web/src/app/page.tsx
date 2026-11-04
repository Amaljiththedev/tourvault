"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FullScreenLoader } from "@/components/ui";
import { useAppSelector } from "@/store/hooks";

// The root just sends people where they belong once the session is known.
export default function Home() {
  const status = useAppSelector((s) => s.auth.status);
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/tours");
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  return <FullScreenLoader />;
}
