## Inspiration

The idea came from that creepy feeling you get when you realize Big Tech is essentially having access to everything you tell an AI. Recently, we learned about Pentagon asking companies like Anthropic to help monitor what people are saying, and it made us realize: if someday, we can't trust the companies behind the models, we need to take control ourselves. We wanted to build a safety net. Something that sits quietly in the background and catches your private info before it ever leaves your computer. We knew that if a privacy tool is a "hassle," nobody will use it. So, our goal was simple: maximum privacy with zero compromise on convenience.

## What it does

**Fegis** is basically a bouncer for your browser. When you're chatting with LLM like ChatGPT or Gemini, it sits in the middle and watches for things you probably shouldn't be sharin - like your real name, phone number, credit card, or even API keys. Just like Grammarly catches your typos, Fegis catches your privacy leaks before they happen.

You can set it to two modes:

- **Block Mode**: This is your manual check. If Fegis spots something sensitive, it stops the message and asks, "Hey, are you sure you want to share this?" You can then choose to send it anyway or mask it using:
  - **Tokens**: Swaps your info for labels like `[NAME_1]` or `[EMAIL_2]`. It remembers these, so the same name always gets the same token.
  - **Fake Data**: Generates "real-looking" fakes. Your phone number stays phone-shaped, and your credit card still looks like a credit card, but the numbers are deterministic fakes seeded by your real data.
- **Auto-Replacement Mode**: This is for when you want privacy without the hassle.
  - **What you see**: Everything on the page looks totally normal. You see your real info in the messages you send and the replies you get back.
  - **What the AI sees**: Fegis automatically swaps your real info for those fakes/tags in real-time before it hits the AI's servers.
  - **The Benefit**: You can copy an AI-optimized email directly to your clipboard with your real name already in it, even though the AI never actually knew who you were. If you’re ever curious about what the AI actually received, just **hover over the text**. A tooltip will show you the mask that was sent (e.g., seeing "sent as Dr. Smith" while your screen shows your real name).

## How we built it

We built this as a Chrome extension using **React** and **TypeScript**. Since we wanted to keep everything private, all the "detecting" happens right in your browser—nothing is sent to a server. We used some clever libraries to help us read files like PDFs and Word docs, and even used OCR to "read" text inside images you try to upload.

## Challenges we ran into

The hardest part was "intercepting" the messages. Modern AI sites don't just send a simple text message; they use websocket to stream the conversation back and forth. Trying to catch those bits of data without breaking the chat was hard. We spent countless hours doing heavy network debugging and digging into the browser's "plumbing" just to make sure our interception was invisible and seamless.

We also struggled with how to actually *find* the private info. We didn't want to guess, so we ran comprehensive head-to-head tests between three different approaches:

- **Local LLMs**: While powerful, they were way too slow and resource-heavy for a browser extension.
- **NER (Named Entity Recognition) Models**: These offered great accuracy but were unstable and difficult to bundle without lagging the browser.
- **Regex Patterns**: These were the surprise MVP.

Our results showed that **Regex won** by a landslide in terms of speed and stability while maintaining a high success rate for detection. By building a hybrid system centered on these optimized patterns, we created a tool that catches secrets instantly as you type, without your computer breaking a sweat.

## Accomplishments that we're proud of

We’re really hyped that we got **local file scanning** to work. People often leak sensitive data through file uploads, so being able to scan a PDF or a screenshot for secrets entirely within your browser, without a single byte ever leaving your RAM, is a massive win for privacy.

We are also proud of the **speed and accuracy** of our detection engine. We found a "sweet spot" that catches PII instantly as you type without slowing your computer down at all. Finally, seeing the **Auto-Replace mode** work seamlessly was a huge highlight for us. It’s pretty cool to see your real info on the screen while knowing the AI is only receiving safe, masked data. It proves that you don't have to give up convenience to keep your life private.

## What we learned

We learned that building a Chrome extension is way more complicated than it looks! You have to coordinate between several different isolated execution environment, like content scripts and background service worker, that all live in their own separate environment. Getting all these parts to communicate securely without breaking the site was a real challenge.

We also learned how to build and deploy a polished web app using Vercel to host our interactive demo.

Most importantly, we realized just how much personal data we all accidentally leak every day. Seeing Fegis highlight secrets in real-time really showed us how much we share when we’re just trying to get an AI to help us with work.

## What's next for Fegis

We want to make the "fake" data even more realistic so the AI doesn't get confused by the context. We're also looking into even smarter ways to detect PI, like training small models on our own, to further increase our detection rates.

Next, we want to add **sync across accounts**. This would allow different devices to remember how your info was changed, so you can seamlessly view your masked chats across multiple computers without losing track of what’s what.