export interface Column<Row extends Record<string, unknown> = Record<string, unknown>> {
  key: keyof Row | string;
  header: string;
  width?: number;
  align?: "left" | "center" | "right";
  format?: (value: unknown, row: Row) => string;
}
