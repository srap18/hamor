import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-bold cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.97] select-none",
  {
    variants: {
      variant: {
        default:
          "text-[#2a1605] border border-[#3a1f0a] [background:radial-gradient(ellipse_at_50%_0%,#ffe9a8_0%,#f1be52_35%,#c98a2a_70%,#7a4a14_100%)] [box-shadow:inset_0_1px_0_rgba(255,243,200,0.85),inset_0_-2px_4px_rgba(80,40,10,0.55),0_3px_0_#3a1f0a,0_5px_10px_rgba(0,0,0,0.5)] hover:brightness-110 active:[box-shadow:inset_0_2px_4px_rgba(80,40,10,0.7),0_1px_0_#3a1f0a] [text-shadow:0_1px_0_rgba(255,243,200,0.6)]",
        destructive:
          "text-[#fff5e0] border border-[#3a0a0a] [background:radial-gradient(ellipse_at_50%_0%,#ff8a6a_0%,#e53935_40%,#8f1212_100%)] [box-shadow:inset_0_1px_0_rgba(255,200,180,0.6),inset_0_-2px_4px_rgba(60,5,5,0.6),0_3px_0_#3a0a0a,0_5px_10px_rgba(0,0,0,0.5)] hover:brightness-110 [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]",
        outline:
          "text-[#ead087] border-2 border-[#c9a44a] bg-[linear-gradient(180deg,rgba(40,22,8,0.85),rgba(20,10,4,0.9))] [box-shadow:inset_0_1px_0_rgba(255,230,170,0.25),0_2px_0_#3a1f0a,0_4px_10px_rgba(0,0,0,0.5)] hover:bg-[linear-gradient(180deg,rgba(60,32,12,0.9),rgba(30,16,6,0.95))] [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]",
        secondary:
          "text-[#ead087] border border-[#8a6520] [background:linear-gradient(180deg,#3a230e_0%,#22150a_100%)] [box-shadow:inset_0_1px_0_rgba(255,230,170,0.18),inset_0_-2px_4px_rgba(0,0,0,0.5),0_3px_0_#1a0e06,0_5px_10px_rgba(0,0,0,0.45)] hover:brightness-125 [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]",
        ghost:
          "text-[#ead087] hover:bg-[rgba(241,190,82,0.12)] hover:text-[#ffe9a8] [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]",
        link: "text-[#ead087] underline-offset-4 hover:underline hover:text-[#ffe9a8]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
