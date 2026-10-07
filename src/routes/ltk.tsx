import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/ltk")({
  beforeLoad: () => {
    throw redirect({ to: "/mods" });
  },
});
