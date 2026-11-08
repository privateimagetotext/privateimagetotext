import { Link } from "react-router";
import { homepageFaqs } from "../config/homepage-faq";

export function HomepageFaq() {
  return <section className="homepage-faq" aria-labelledby="homepage-faq-title">
    <p className="eyebrow">Questions about image OCR</p>
    <h2 id="homepage-faq-title">Frequently asked questions</h2>
    {homepageFaqs.map((faq) => <details className="technical-details" id={faq.id} key={faq.question}>
      <summary>{faq.question}</summary>
      <p>{faq.answer.map((part, index) => part.to
        ? <Link key={index} to={part.to}>{part.text}</Link>
        : part.text)}</p>
    </details>)}
  </section>;
}
