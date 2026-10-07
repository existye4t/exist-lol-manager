import { createFileRoute } from "@tanstack/react-router";

import { ExistSkinLibrary } from "@/pages/ExistSkinLibrary";

export const Route = createFileRoute("/skins")({
  component: ExistSkinLibrary,
});
