import { memo } from "react";
import coinImg from "@/assets/icon-coin-3d.png";
import gemImg from "@/assets/icon-gem-3d.png";
import rubyImg from "@/assets/icon-ruby-3d.png";

type Props = { size?: number; className?: string };

const base = "inline-block align-middle drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)] select-none";

export const CoinIcon = memo(function CoinIcon({ size = 20, className = "" }: Props) {
  return <img src={coinImg} alt="رصيد الذهب — gold coins balance" width={size} height={size} loading="eager" decoding="async" fetchPriority="high" className={`${base} ${className}`} style={{ width: size, height: size }} />;
});
export const GemIcon = memo(function GemIcon({ size = 20, className = "" }: Props) {
  return <img src={gemImg} alt="رصيد الجواهر الزرقاء — premium blue gems balance" width={size} height={size} loading="eager" decoding="async" fetchPriority="high" className={`${base} ${className}`} style={{ width: size, height: size }} />;
});
export const RubyIcon = memo(function RubyIcon({ size = 20, className = "" }: Props) {
  return <img src={rubyImg} alt="رصيد الياقوت الأحمر — red ruby currency balance" width={size} height={size} loading="eager" decoding="async" fetchPriority="high" className={`${base} ${className}`} style={{ width: size, height: size }} />;
});
