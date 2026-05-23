/** 브라우저 기본 validation 말풍선 대신 앱 테마 인라인 안내 */
export default function FieldValidationCallout({
  message,
  id,
}: {
  message: string;
  id?: string;
}) {
  return (
    <p className="field-validation-callout" role="alert" id={id}>
      <span className="field-validation-callout__icon" aria-hidden>
        !
      </span>
      <span className="field-validation-callout__text">{message}</span>
    </p>
  );
}
