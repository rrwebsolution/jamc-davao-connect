import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/states";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="We couldn't find that record"
      description="It may have been removed, or you may not have access to it."
      action={
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Go to home
        </Link>
      }
    />
  );
}