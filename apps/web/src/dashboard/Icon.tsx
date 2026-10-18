export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    residents:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8 M20 8v6 M17 11h6",
    history: "M3 12a9 9 0 1 0 2-6 M3 3v5h5 M12 7v5l3 2",
    devices: "M4 4h16v12H4z M8 20h8 M12 16v4",
    wifi: "M3 8a15 15 0 0 1 18 0 M6 12a10 10 0 0 1 12 0 M9 16a5 5 0 0 1 6 0 M12 20h.01",
    offline:
      "M3 3l18 18 M4 8a15 15 0 0 1 5-2 M14 6a15 15 0 0 1 7 2 M6 12a10 10 0 0 1 4-2 M9 16a5 5 0 0 1 6 0 M12 20h.01",
    shield: "M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z",
    alert: "M12 3 2 21h20L12 3z M12 9v5 M12 17h.01",
    check: "m5 12 4 4 10-10",
    menu: "M4 6h16 M4 12h16 M4 18h16",
    close: "m6 6 12 12 M6 18 18 6",
    arrow: "M4 12h16 m-6-6 6 6-6 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.overview} />
    </svg>
  );
}
