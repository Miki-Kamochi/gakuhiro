import { redirect } from "next/navigation";

/** The shop moved to the front page; keep old /shop links working. */
export default function OldShop() {
  redirect("/");
}
