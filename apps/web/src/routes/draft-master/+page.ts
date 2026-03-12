import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, parent }) => {
  const { heroes } = await parent();
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const rankScope = url.searchParams.get("rankScope") ?? "mythic_glory";
  return { timeframe, rankScope, heroes };
};
