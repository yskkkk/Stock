import { useEffect, useState } from "react";
import { isMobilePhoneEnv } from "../lib/isMobilePhone";

export function useIsMobilePhone(): boolean {
  const [mobile, setMobile] = useState(isMobilePhoneEnv);

  useEffect(() => {
    const update = () => setMobile(isMobilePhoneEnv());
    const mqs = ["(max-width: 900px)", "(pointer: coarse)"].map((q) =>
      window.matchMedia(q),
    );
    for (const mq of mqs) mq.addEventListener("change", update);
    update();
    return () => {
      for (const mq of mqs) mq.removeEventListener("change", update);
    };
  }, []);

  return mobile;
}
