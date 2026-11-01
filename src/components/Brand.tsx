/** The shop logo mark (the app icon) shown on the sign-in screens, the sidebar and the licence screen. */
export function ShopLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return <img src="./icon.png" alt="Electronics Shop ERP" width={size} height={size} draggable={false} className={`rounded-xl object-cover ${className}`} />;
}
