import type { ActivityRow } from "@shared/types";
import { getDb } from "./db";
import { nextDay, nowLocal } from "./util";

export function logActivity(userId: number | null, action: string, target = "", detail = ""): void {
  getDb().prepare("insert into activity_log (at, user_id, action, target, detail) values (?, ?, ?, ?, ?)").run(nowLocal(), userId, action, target, detail);
}

export function activityList(from: string, to: string, q: string): ActivityRow[] {
  const like = `%${q.trim()}%`;
  return getDb()
    .prepare(
      `select a.at, coalesce(u.name, '') as user_name, a.action, a.target, a.detail
       from activity_log a left join users u on u.id = a.user_id
       where a.at >= ? and a.at < ? and (a.action like ? or a.target like ? or a.detail like ? or u.name like ?)
       order by a.id desc limit 500`
    )
    .all(from, nextDay(to), like, like, like, like) as ActivityRow[];
}
