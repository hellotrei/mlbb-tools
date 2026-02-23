import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, url }) => {
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const role = url.searchParams.get("role") ?? "";
  const lane = url.searchParams.get("lane") ?? "";
  const speciality = url.searchParams.get("speciality") ?? "";
  const sort = url.searchParams.get("sort") ?? "win_rate";
  const order = url.searchParams.get("order") ?? "desc";
  const page = url.searchParams.get("page") ?? "1";
  const limit = url.searchParams.get("limit") ?? "50";
  const search = url.searchParams.get("search") ?? "";

  const params = new URLSearchParams({ timeframe, sort, order, page, limit });
  if (role) params.set("role", role);
  if (lane) params.set("lane", lane);
  if (speciality) params.set("speciality", speciality);
  if (search) params.set("search", search);

  const [statsRes, heroesRes] = await Promise.all([
    fetch(apiUrl(`/stats?${params.toString()}`)),
    fetch(apiUrl("/heroes"))
  ]);

  const stats = await statsRes.json();
  const heroes = await heroesRes.json();

  return {
    filters: { timeframe, role, lane, speciality, sort, order, page, limit, search },
    stats,
    heroes: heroes.items ?? []
  };
};
