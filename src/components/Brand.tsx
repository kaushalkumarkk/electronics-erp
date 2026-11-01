/** DevNexa branding: the logo mark and the "built by" credit shown on the sign-in screens, sidebar and Settings. */

export const DEVNEXA = {
  name: "DevNexa",
  site: "company-frontend-two.vercel.app",
  people: "Shivam Raj & Kaushal Kumar",
  phone: "6201672113",
  support: "9102257101 / 6201672113",
};

export function DevNexaLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return <img src="./devnexa-digital-logo.jpg" alt="DevNexa Digital" width={size} height={size} draggable={false} className={`rounded-xl object-cover ${className}`} />;
}

/** "Built by DevNexa · Shivam & Kaushal · 6201672113, 9102257101" (sign-in screen) */
export function BuiltBy({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"} ${className}`}>
      <DevNexaLogo size={18} className="rounded-md" />
      <span>
        Built by <b className={dark ? "text-slate-200" : "text-slate-700"}>DevNexa</b> · Shivam &amp; Kaushal · 6201672113, 9102257101
      </span>
    </div>
  );
}
