// Decoy words for the Vosk grammar. With only the trigger words and "[unk]" to choose from, Vosk
// explains ordinary chatter with trigger words far too often ("bread" → "brain", "noon" → "moon").
// Giving it common words and near-misses to pick instead keeps false triggers down; the matcher
// ignores them because they aren't in the vocabulary. Anything that is in the vocabulary (or a
// homophone spelling of it) is removed before the grammar is built.
//
// Never add a true homophone of a trigger word here ("son" for "sun", "rap" for "wrap",
// "dyed" for "died"): it would tie with the trigger and randomly swallow real hits. Homophones
// trigger on purpose (GDD §7.7, steak/stake).

/** Words that sound close to current trigger words, so near-misses have somewhere to go. */
const NEAR_MISSES = [
  // moon / dog / full / puppy
  'noon', 'soon', 'spoon', 'mood', 'moan', 'mean', 'room', 'dock', 'duck', 'dug', 'dark', 'fall',
  'fill', 'feel', 'pull', 'wool', 'food', 'poppy', 'happy',
  // garlic / sun / sunny / sunshine / stake / cross
  'garage', 'garden', 'some', 'fun', 'run', 'done', 'funny', 'money', 'shine', 'stack', 'stay',
  'take', 'state', 'snack', 'shake', 'make', 'across', 'boss', 'cost', 'course',
  // dead / died / death / funeral / ghost / haunted
  'dad', 'did', 'bed', 'red', 'said', 'tide', 'side', 'deaf', 'breath', 'general', 'goes',
  'coast', 'most', 'post', 'toast', 'hunted', 'wanted',
  // thanks / thank you / stone / snake / wrap / unwind / egypt / dust / brain / head
  'tanks', 'banks', 'thinks', 'thing', 'tone', 'alone', 'phone', 'own', 'snack', 'map', 'wrapped',
  'behind', 'wind', 'find', 'mind', 'kind', 'just', 'must', 'trust', 'rain', 'train', 'plain',
  'bread', 'had', 'storm',
  // host-exposure words
  'woman', 'humid', 'formal', 'more', 'texas', 'taxis', 'him', 'jim', 'solid', 'valid', 'mom',
]; // prettier-ignore

/** Very common conversational words. */
const COMMON = [
  'a', 'an', 'the', 'and', 'but', 'or', 'so', 'if', 'then', 'than', 'that', 'this', 'these',
  'those', 'there', 'here', 'where', 'when', 'what', 'why', 'how', 'who', 'which', 'it', 'is',
  'was', 'were', 'be', 'been', 'am', 'are', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'her',
  'us', 'them', 'my', 'your', 'his', 'our', 'their', 'yourself', 'myself', 'of', 'to', 'for',
  'with', 'from', 'by', 'on', 'at', 'in', 'into', 'out', 'up', 'down', 'over', 'about', 'after',
  'before', 'very', 'really', 'too', 'also', 'not', 'no', 'yes', 'yeah', 'okay', 'oh', 'well',
  'now', 'still', 'again', 'all', 'any', 'much', 'many', 'little', 'lot', 'one', 'two', 'three',
  'four', 'five', 'ten', 'first', 'last', 'next', 'other', 'another', 'every', "don't", "i'm",
  "it's", "that's", "you're", "can't", 'do', 'does', 'have', 'has', 'get', 'got', 'go', 'going',
  'went', 'come', 'came', 'made', 'took', 'give', 'know', 'think', 'say', 'tell', 'see', 'saw',
  'look', 'want', 'like', 'love', 'need', 'try', 'call', 'ask', 'work', 'play', 'eat', 'drink',
  'cook', 'pass', 'sit', 'wait', 'talk', 'keep', 'let', 'put', 'help', 'start', 'live', 'bring',
  'hear', 'walk', 'open', 'close', 'pour', 'smell', 'taste', 'remember', 'guess', 'hope', 'time',
  'day', 'night', 'today', 'tonight', 'week', 'year', 'morning', 'evening', 'fork', 'knife',
  'plate', 'glass', 'cup', 'table', 'chair', 'kitchen', 'house', 'home', 'door', 'window',
  'soup', 'wine', 'water', 'cake', 'dinner', 'lunch', 'dessert', 'cheese', 'chicken', 'fish',
  'meat', 'rice', 'sauce', 'salt', 'pepper', 'butter', 'tea', 'coffee', 'family', 'friend',
  'mother', 'father', 'brother', 'sister', 'cousin', 'uncle', 'kids', 'baby', 'people', 'man',
  'name', 'job', 'school', 'car', 'weather', 'cold', 'hot', 'nice', 'good', 'great', 'fine',
  'bad', 'lovely', 'wonderful', 'beautiful', 'amazing', 'delicious', 'sweet', 'weird', 'sorry',
  'please', 'hello', 'cheers', 'welcome', 'maybe', 'sure', 'right', 'back', 'away', 'everything',
  'nothing', 'something', 'story', 'music', 'party', 'game', 'book', 'movie', 'place', 'world',
  'life', 'minute',
]; // prettier-ignore

export const VOSK_DECOYS: readonly string[] = [...new Set([...NEAR_MISSES, ...COMMON])];
